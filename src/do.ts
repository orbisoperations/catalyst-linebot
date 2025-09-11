import { DurableObject } from 'cloudflare:workers';
import { Env } from '../worker-configuration';
import { LineAPI } from './line';
import { LinebotPostbackEvent } from './types';

const LOOP_S = 30;
export interface PingEvent {
	title: string;
	city: string;
	latlong: string;
	randomPhrase: string;
	expiry: number;
	from: string;
}
export class LineBotState extends DurableObject<Env> {
	async alarmInit(enabled: boolean) {
		if (enabled) {
			const currentAlarm = await this.ctx.storage.getAlarm();
			if (currentAlarm == null) {
				await this.ctx.storage.setAlarm(Date.now() + LOOP_S * 1000); // 30 seconds
			}
		} else {
			await this.ctx.storage.deleteAlarm();
		}
		return this.ctx.storage.getAlarm();
	}
	async alarm() {
		// Wrap the entire alarm in a try / catch to prevent the Durable Object from
		// throwing uncaught exceptions which can bubble up as a 400 response.
		try {
			const users = (await this.ctx.storage.get<string[]>('users')) ?? [];
			const pings = await this.getPostbackData();
			console.log('current pings', pings);

			// LINE helper
			const lineAPI = new LineAPI(this.env.LINE_CHANNEL_TOKEN);

			// ------------------------------
			// 1. Build LINE-ping summaries
			// ------------------------------
			const lineMessages = pings.map((ping) => {
				return `Line Message: ${ping.title}\n\tUUID: ${ping.randomPhrase}\n\tCoords: ${ping.latlong}\n\texpires in: ${
					(ping.expiry - Date.now()) / 1000
				}s`;
			});

			// ------------------------------
			// 2. Fetch TAK data (with its own error boundary)
			// ------------------------------
			const queries = [
				`query {\n  TAK1Markers {\n    uid\n    callsign\n    lat\n    lon\n    namespace\n  }\n}`,
				`query {\n  TAK2Markers {\n    uid\n    callsign\n    lat\n    lon\n    namespace\n  }\n}`,
			];

			let takItems: { uid: string; callsign: string; lat: number; lon: number; namespace: string }[] = [];

			try {
				takItems = (
					await Promise.all(
						queries.map(async (query) => {
							try {
								const response = await fetch(this.env.CATALYST_GATEWAY_URL, {
									method: 'POST',
									headers: {
										'Content-Type': 'application/json',
										Authorization: `Bearer ${this.env.CATALYST_GATEWAY_TOKEN}`,
									},
									body: JSON.stringify({ query }),
								});

								if (response.status !== 200) {
									console.error('TAK fetch – non-200 status', response.status);
									return [];
								}

								interface TakData {
									data: {
										TAK1Markers?: { uid: string; callsign: string; lat: number; lon: number; namespace: string }[];
										TAK2Markers?: { uid: string; callsign: string; lat: number; lon: number; namespace: string }[];
									};
									errors?: { message: string; location: unknown }[];
								}

								const takJSON = await response.json<TakData>();

								if (takJSON.errors) {
									console.error('TAK fetch – GraphQL errors', takJSON.errors);
									return [];
								}

								return takJSON.data.TAK1Markers ?? takJSON.data.TAK2Markers ?? [];
							} catch (err) {
								console.error('TAK query failed', err);
								return [];
							}
						})
					)
				).flat(1);
			} catch (err) {
				// Should never reach here because individual fetches are caught, but just in case
				console.error('Unexpected TAK aggregation error', err);
				takItems = [];
			}

			const takMessages = takItems.map((item) => {
				return `TAK Point: ${item.callsign}\n\tServer: ${item.namespace}\n\tCoords: ${item.lat}, ${item.lon}`;
			});

			console.log('tak messages', takMessages);

			// ------------------------------
			// 3. Push summary back to users
			// ------------------------------
			if (lineMessages.length > 0 || takMessages.length > 0) {
				const combinedMsg = `Summary of Current Events: \n${lineMessages.join(' \n')}\n${takMessages.join(' \n')}`;

				const pushPromises = Array.from(users).map((user) =>
					lineAPI.push({
						to: user,
						messages: [
							{
								type: 'text' as const,
								text: combinedMsg,
							},
						],
					})
				);

				const results = await Promise.allSettled(pushPromises);
				results.forEach((res) => {
					if (res.status === 'rejected') {
						console.error('LINE push failed', res.reason);
					}
				});
			}
		} catch (err) {
			// Catch any unexpected error so the alarm never propagates an exception
			console.error('Unhandled error in alarm()', err);
		} finally {
			// Ensure the alarm is always rescheduled even if something fails
			try {
				await this.ctx.storage.setAlarm(Date.now() + LOOP_S * 1000);
			} catch (e) {
				console.error('Failed to schedule next alarm', e);
			}
		}
	}
	async trackUser(userId: string) {
		let users = (await this.ctx.storage.get<string[]>('users')) ?? [];
		const newUserList = [...Array.from(users), userId];
		await this.ctx.storage.put('users', newUserList);
	}

	async removeUser(userId: string) {
		let users: string[] = (await this.ctx.storage.get<string[]>('users')) ?? [];
		const newUserList = Array.from(users).filter((user) => user != userId);
		await this.ctx.storage.put('users', newUserList);
	}

	async removeAllUsers() {
		console.log('removing all users from demo');
		await this.ctx.storage.put('users', []);
	}

	async storePingEvent(ping: PingEvent) {
		console.log('Storing ping event: ', JSON.stringify(ping));
		await this.ctx.blockConcurrencyWhile(async () => {
			const pings = (await this.ctx.storage.get<PingEvent[]>('pings')) ?? [];
			pings.push({
				latlong: ping.latlong,
				expiry: Date.now() + 1 * 60 * 1000, // 1m x 60s x 1000ms,
				city: ping.city,
				title: ping.title,
				randomPhrase: ping.randomPhrase,
				from: ping.from,
			});
			console.log(pings);
			await this.ctx.storage.put('pings', pings);
		});
		return {
			coords: new URLSearchParams({
				latlong: ping.latlong,
				expiry: String(Date.now() + 1 * 60 * 1000), // 1m x 60s x 1000ms,
				city: ping.city,
				title: ping.title,
				randomPhrase: ping.randomPhrase,
			}).toString(),
		};
	}
	async storePostback(msg: LinebotPostbackEvent) {
		console.log('Storing postback event: ', JSON.stringify(msg));
		await this.ctx.blockConcurrencyWhile(async () => {
			const pings = (await this.ctx.storage.get<PingEvent[]>('pings')) ?? [];
			const searchParams = new URLSearchParams(msg.postback.data);
			pings.push({
				latlong: searchParams.has('latlong') ? searchParams.get('latlong')! : 'no latlong provided',
				expiry: Date.now() + 1 * 60 * 1000, // 1m x 60s x 1000ms,
				city: searchParams.has('city') ? searchParams.get('city')! : 'no city provided',
				title: searchParams.has('title') ? searchParams.get('title')! : 'no title provided',
				randomPhrase: searchParams.has('randomPhrase') ? searchParams.get('randomPhrase')! : 'no UID provided',
				from: searchParams.has('from') ? searchParams.get('from')! : 'no from provided',
			});
			console.log(pings);
			await this.ctx.storage.put('pings', pings);
		});
		return {
			reply: msg.replyToken,
			coords: msg.postback.data,
		};
	}

	async getPostbackData(): Promise<PingEvent[]> {
		const pings = (await this.ctx.storage.get<PingEvent[]>('pings')) ?? [];
		const now = Date.now();
		console.log('getPostbackData', JSON.stringify(pings));
		const validPings = pings.filter((ping) => ping.expiry > now);
		console.log('getPostbackData after filtration, replacing original with:', JSON.stringify(validPings));
		await this.ctx.storage.put('pings', validPings);
		return validPings;
	}
}
