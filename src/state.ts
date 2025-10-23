/*
 * Container-friendly replacement for the Cloudflare Durable Object previously
 * used in production.  This version keeps state in a module-level singleton so
 * that a regular Node/Bun runtime (e.g. inside Docker) can run the same
 * business logic without Cloudflare-specific primitives.
 *
 * ‑ No persistence guarantee (memory only)
 * ‑ Alarm scheduling via setInterval instead of ctx.storage.setAlarm()
 * ‑ API surface kept identical so the rest of the codebase doesn’t need to
 *   change right away
 */

import { LineAPI } from './line';
import { LinebotPostbackEvent } from './types';
import { Database } from 'bun:sqlite';

// ---------------- Constants / Types ----------------

const LOOP_S = 30; // seconds

export interface PingEvent {
	title: string;
	city: string;
	latlong: string;
	randomPhrase: string;
	expiry: number;
	from: string;
}

// ---------------- Persistent storage via SQLite ----------------
// The DB file lives at /data/state.sqlite (mounted volume on Fly)
const db = new Database('/data/state.sqlite');
db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY);`);
// Still keep pings in memory – they are short-lived and don't need persistence

// ---------------- In-memory storage ----------------

const memStore = {
	// pings in-memory only
	pings: [] as PingEvent[],
};

// ---------------- Helper functions ----------------

function pruneExpiredPings() {
	const now = Date.now();
	memStore.pings = memStore.pings.filter((p) => p.expiry > now);
}

// ---------------- Main Class ----------------

export class LineBotState {
	private alarmTimer: ReturnType<typeof setInterval> | null = null;
	private readonly lineAPI: LineAPI;

	constructor(
		private readonly env: {
			LINE_CHANNEL_TOKEN: string;
			CATALYST_GATEWAY_URL: string;
			CATALYST_GATEWAY_TOKEN: string;
		}
	) {
		this.lineAPI = new LineAPI(env.LINE_CHANNEL_TOKEN);
	}

	// ---------- Alarm / summary loop ----------
	async alarmInit(enabled: boolean) {
		if (enabled && !this.alarmTimer) {
			this.alarmTimer = setInterval(() => {
				this.alarm().catch((e) => console.error('alarm error', e));
			}, LOOP_S * 1000);
			console.log('Alarm scheduled every', LOOP_S, 's');
		} else if (!enabled && this.alarmTimer) {
			clearInterval(this.alarmTimer);
			this.alarmTimer = null;
			console.log('Alarm disabled');
		}
		return Date.now() + LOOP_S * 1000;
	}

	// Fetches TAK data and publishes summary event to Line Users
	private async alarm() {
		try {
			pruneExpiredPings();
			const lineMessages = memStore.pings.map(
				(p) =>
					`Line Message: ${p.title}\n\tUUID: ${p.randomPhrase}\n\tCoords: ${p.latlong}\n\texpires in: ${(p.expiry - Date.now()) / 1000}s`
			);

			// TAK fetch – unchanged logic, kept for compatibility
			const queries = [
				`query {\n  TAK1Markers { uid callsign lat lon namespace }\n}`,
				`query {\n  TAK2Markers { uid callsign lat lon namespace }\n}`,
			];

			let takItems: { uid: string; callsign: string; lat: number; lon: number; namespace: string }[] = [];
			for (const query of queries) {
				try {
					const r = await fetch(this.env.CATALYST_GATEWAY_URL, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							Authorization: `Bearer ${this.env.CATALYST_GATEWAY_TOKEN}`,
						},
						body: JSON.stringify({ query }),
					});
					if (r.ok) {
						const json = await r.json();
						takItems.push(...(json.data?.TAK1Markers ?? json.data?.TAK2Markers ?? []));
					} else console.error('TAK fetch non-200', r.status);
				} catch (e) {
					console.error('TAK fetch error', e);
				}
			}

			const takMessages = takItems.map((i) => `TAK Point: ${i.callsign}\n\tServer: ${i.namespace}\n\tCoords: ${i.lat}, ${i.lon}`);

			if (lineMessages.length || takMessages.length) {
				const msg = `Summary of Current Events:\n${lineMessages.join('\n')}\n${takMessages.join('\n')}`;
				const userIds = this.getAllUserIds();
				const promises = userIds.map((u) => this.lineAPI.push({ to: u, messages: [{ type: 'text', text: msg }] }));
				await Promise.allSettled(promises);
			}
		} catch (err) {
			console.error('Unhandled error in alarm()', err);
		}
	}

	// ---------- User tracking (persistent) ----------
	async trackUser(userId: string) {
		try {
			db.run('INSERT OR IGNORE INTO users (id) VALUES (?);', [userId]);
		} catch (e) {
			console.error('Error adding user to DB', e);
		}
	}

	async removeUser(userId: string) {
		try {
			db.run('DELETE FROM users WHERE id = ?;', [userId]);
		} catch (e) {
			console.error('Error removing user from DB', e);
		}
	}

	private getAllUserIds(): string[] {
		try {
			return db
				.query('SELECT id FROM users;')
				.all()
				.map((r: any) => r.id as string);
		} catch (e) {
			console.error('Error fetching users', e);
			return [];
		}
	}

	// ---------- Ping storage ----------
	async storePingEvent(ping: PingEvent) {
		pruneExpiredPings();
		memStore.pings.push({ ...ping, expiry: Date.now() + 60_000 });
		return {
			coords: new URLSearchParams({
				latlong: ping.latlong,
				expiry: String(Date.now() + 60_000),
				city: ping.city,
				title: ping.title,
				randomPhrase: ping.randomPhrase,
			}).toString(),
		};
	}

	async storePostback(msg: LinebotPostbackEvent) {
		const sp = new URLSearchParams(msg.postback.data);
		await this.storePingEvent({
			latlong: sp.get('latlong') ?? '0,0',
			city: sp.get('city') ?? 'unknown',
			title: sp.get('title') ?? 'unknown',
			randomPhrase: sp.get('randomPhrase') ?? 'NOP',
			from: sp.get('from') ?? 'unknown',
			expiry: 0, // overwritten
		});
		return { reply: msg.replyToken, coords: msg.postback.data };
	}

	async getPostbackData(): Promise<PingEvent[]> {
		pruneExpiredPings();
		return [...memStore.pings];
	}
}

// Provide a singleton instance factory to mimic DurableObjectNamespace.get()
export function getLineBotStateSingleton(env: LineBotState['env']): LineBotState {
	// Attach to globalThis so multiple imports share the same instance
	const g = globalThis as any;
	if (!g.__lineBotStateSingleton) {
		g.__lineBotStateSingleton = new LineBotState(env);
	}
	return g.__lineBotStateSingleton as LineBotState;
}
