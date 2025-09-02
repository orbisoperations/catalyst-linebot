import { WorkerEntrypoint } from 'cloudflare:workers';
import { Env } from '../worker-configuration';
export { LineBotState } from './do';
import { Hono } from 'hono';
import { LineBotState } from './do';
import { createYoga } from 'graphql-yoga';
import gqlSchema from './graphql';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { generate } from 'random-words';
// @ts-ignore
import { Buffer } from 'node:buffer';
import {
	LinebotEvent,
	LinebotMessageEvent,
	LinebotUnfollowEvent,
	LinebotFollowEvent,
	pingCards,
	pingCarousel,
	LinebotPostbackEvent,
} from './types';
import { LineAPI } from './line';

function safeCompare(a: Buffer, b: Buffer): boolean {
	if (a.length !== b.length) {
		return false;
	}
	// @ts-ignore
	return crypto.subtle.timingSafeEqual(a, b);
}

async function validateSignature(secret: string, body: string, signatureHeader?: string) {
	//console.log("creating hmac functions")
	const encoder = new TextEncoder();
	const encodedKey = encoder.encode(secret);
	const encodedData = encoder.encode(body);
	const hmacKey = await crypto.subtle.importKey(
		'raw',
		encodedKey,
		{
			name: 'HMAC',
			hash: 'SHA-256',
		},
		true,
		['sign', 'verify']
	);

	const rawDigest = await crypto.subtle.sign('HMAC', hmacKey, encodedData);
	const digest = Buffer.from(Buffer.from(rawDigest).toString('base64'));
	const signature = Buffer.from(signatureHeader ?? '');
	//console.log(`digest: ${digest}`)
	//console.log(`signature: ${signature}`)
	const valid = safeCompare(digest, signature);
	return valid;
}

/**
 * Welcome to Cloudflare Workers! This is your first Durable Objects application.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your Durable Object in action
 * - Run `npm run deploy` to publish your application
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/durable-objects
 */

/** A Durable Object's behavior is defined in an exported Javascript class */
type bindings = {
	LineBotState: DurableObjectNamespace<LineBotState>;
	LINE_CHANNEL_TOKEN: string;
	LINE_CHANNEL_SECRET: string;
	DEMO_ACTIVE: string;
	CATALYST_JWK_URL: string;
	CATALYST_APP_ID: string;
	RAPID_API_KEY: string;
};

type Variables = {
	valid: boolean;
};

const app: Hono<{ Bindings: bindings; Variables: Variables }> = new Hono();
app.use('/graphql', async (c) => {
	const JWKS = createRemoteJWKSet(new URL(c.env.CATALYST_JWK_URL));
	const token = c.req.header('Authorization') ? c.req.header('Authorization')!.split(' ')[1] : '';
	let valid = false;
	try {
		const { payload, protectedHeader } = await jwtVerify(token, JWKS);
		valid = payload.claims != undefined && (payload.claims as string[]).includes(c.env.CATALYST_APP_ID);
	} catch (e) {
		console.error('error validating jwt: ', e);
		valid = false;
	}
	c.set('valid', valid);
	const yoga = createYoga({
		schema: gqlSchema,
		graphqlEndpoint: '/graphql',
	});
	console.log('graphql handler');
	return yoga.handle(c.req.raw as Request, c);
});

// ---------------- Geocode Helper ----------------
type GeocodeResult = {
	lat: string;
	lon: string;
	display_name: string;
	address: {
		neighbourhood: string;
		suburb: string;
		village: string;
		city: string;
		country: string;
		postcode: string;
	};
};

async function geocodeLocation(locq: string, env: bindings): Promise<GeocodeResult[]> {
	const url =
		'https://maptoolkit.p.rapidapi.com/geocode/search?' +
		new URLSearchParams({ q: locq, countrycodes: 'TW,US', language: 'en', limit: '1' });

	const resp = await fetch(url, {
		method: 'GET',
		headers: {
			'X-RapidAPI-Key': env.RAPID_API_KEY,
			'X-RapidAPI-Host': 'maptoolkit.p.rapidapi.com',
		},
	});

	if (!resp.ok) {
		throw new Error(`Geocode request failed: ${resp.status} ${resp.statusText}`);
	}

	const jsonResult = (await resp.json()) as GeocodeResult[];
	return jsonResult;
}

// ---------------- Message Handlers ----------------

type LineReplyText = { type: 'text'; text: string };

async function handleLocationMessage({
	message,
	stub,
}: {
	message: LinebotMessageEvent;
	stub: DurableObjectStub<LineBotState>;
}): Promise<LineReplyText | null> {
	if (message.message.type !== 'location') return null;

	const random = generate({ exactly: 3, wordsPerString: 1, formatter: (w) => w.toUpperCase(), join: '_' });

	const pingEvent = await stub.storePingEvent({
		title: `Ping at ${message.message.address}`,
		city: message.message.address,
		latlong: `${message.message.latitude}, ${message.message.longitude}`,
		randomPhrase: random,
		expiry: 0,
		from: message.source.type === 'user' ? message.source.userId : 'unknown',
	});

	const detail = new URLSearchParams(pingEvent.coords);
	return {
		type: 'text',
		text: `New Message Published (${detail.get('randomPhrase')}) at ${detail.get('city')} [${detail.get('latlong')}]: ${detail.get(
			'title'
		)}`,
	};
}

async function handleTextMessage({
	message,
	stub,
	env,
}: {
	message: LinebotMessageEvent;
	stub: DurableObjectStub<LineBotState>;
	env: bindings;
}): Promise<LineReplyText | null> {
	// Format expected: TITLE.LOCATION
	if (message.message.type !== 'text') return null;
	const elems = message.message.text.split('.').filter((e) => e.replace(' ', '').length > 0);
	if (elems.length < 2) return null;

	const [title, locq] = elems;

	let jsonBody: GeocodeResult[] = [];

	try {
		jsonBody = await geocodeLocation(locq, env);
	} catch (err) {
		console.error('Error geocoding location: ', err);
		return null;
	}

	if (jsonBody.length === 0) return null;

	const random = generate({ exactly: 3, wordsPerString: 1, formatter: (w) => w.toUpperCase(), join: '_' });

	const pingEvent = await stub.storePingEvent({
		title,
		city: `${jsonBody[0].address.neighbourhood}, ${jsonBody[0].address.suburb}, ${jsonBody[0].address.village}, ${jsonBody[0].address.city}`,
		latlong: `${jsonBody[0].lat}, ${jsonBody[0].lon}`,
		randomPhrase: random,
		expiry: 0,
		from: message.source.type === 'user' ? message.source.userId : 'unknown',
	});

	const detail = new URLSearchParams(pingEvent.coords);
	return {
		type: 'text',
		text: `New Message Published (${detail.get('randomPhrase')}) at ${detail.get('city')} [${detail.get('latlong')}]: ${detail.get(
			'title'
		)}`,
	};
}

app.use('/', async (c) => {
	try {
		console.log('Linebot webhook endpoint hit');

		const lineAPI = new LineAPI(c.env.LINE_CHANNEL_TOKEN);
		const id = c.env.LineBotState.idFromName('default');
		const stub = c.env.LineBotState.get(id);
		// set/disable alarm first thing - sets to value of demo
		const demoSwitch = c.env.DEMO_ACTIVE === 'true' ? true : false;
		const alarmVal = await stub.alarmInit(demoSwitch);
		if (!demoSwitch) {
			await stub.removeAllUsers();
		}

		console.log('Next alarm: ', alarmVal);

		// get on with chatbot stuff
		const body = await c.req.text();

		console.log('body', JSON.stringify(body));

		const valid = validateSignature(c.env.LINE_CHANNEL_SECRET, body, c.req.header('x-line-signature'));
		if (!valid) {
			// web hook response should always return 200
			console.error('invalid signature - ignoring message');
			return c.status(200);
		}

		console.log('Message is from valid source per LINE');

		const event = LinebotEvent.parse(JSON.parse(body));

		let followQ: LinebotFollowEvent[] = [];
		let unfollowQ: LinebotUnfollowEvent[] = [];
		let messagesQ: LinebotMessageEvent[] = [];
		let postbackQ: LinebotPostbackEvent[] = [];

		event.events.forEach((event) => {
			const { success: unfollowSuccess, data: unfollowData } = LinebotUnfollowEvent.safeParse(event);
			if (unfollowSuccess && unfollowData) {
				unfollowQ.push(unfollowData);
			}

			const { success: messageSuccess, data: messageData } = LinebotMessageEvent.safeParse(event);
			if (messageSuccess && messageData) {
				messagesQ.push(messageData);
			}

			const { success: followSuccess, data: followData } = LinebotFollowEvent.safeParse(event);
			if (followSuccess && followData) {
				followQ.push(followData);
			}

			const { success: postbackSuccess, data: postBackData } = LinebotPostbackEvent.safeParse(event);
			if (postbackSuccess && postBackData) {
				postbackQ.push(postBackData);
			}
		});

		console.log('Message queues created: ', followQ.length, unfollowQ.length, messagesQ.length);

		console.log('Processing messages: ', messagesQ.length);
		const msgResps = await Promise.all(
			messagesQ.map(async (message) => {
				let lineReplyMessage: { type: 'text'; text: string } | undefined;

				try {
					if (message.message && demoSwitch) {
						if (message.message.type === 'location') {
							lineReplyMessage = (await handleLocationMessage({ message, stub })) ?? undefined;
						} else if (message.message.type === 'text') {
							lineReplyMessage = (await handleTextMessage({ message, stub, env: c.env })) ?? undefined;
						}
					}
				} catch (err) {
					console.error('Error processing line message: ', JSON.stringify(message), err);
				}

				console.log(
					`Sending reply message to LINE: for ${
						message.message.type === 'text'
							? message.message?.text ?? 'unknown'
							: message.message.type === 'location'
							? message.message?.address ?? 'unknown'
							: 'unknown'
					}: ${JSON.stringify(lineReplyMessage)}`
				);

				// if no message, send a default message
				const extraMessages = demoSwitch ? [pingCarousel] : [];
				const lineReplyResponse = await lineAPI.reply({
					replyToken: message.replyToken,
					messages: [
						...(lineReplyMessage ? [lineReplyMessage] : []),
						{
							type: 'text',
							text: demoSwitch
								? 'Please select a message from the catalog or provide a custom message in the format {MESSAGE}.{LOCATION}'
								: 'Hello Friend',
						},
						...extraMessages,
					],
				});

				if (lineReplyResponse.status !== 200) {
					console.error('Error sending reply to line: ', lineReplyResponse.statusText);
				} else {
					console.log('Reply message sent to LINE successfully: ', JSON.stringify(lineReplyResponse));
				}
			})
		);
		console.log('Responses:', JSON.stringify(msgResps));

		console.log('Processing unfollows: ', unfollowQ.length);
		await Promise.all(
			unfollowQ.map(async (message) => {
				return stub.removeUser(message.source.userId);
			})
		);

		console.log('Processing follows');
		const followReps = await Promise.all(
			followQ.map(async (message) => {
				await stub.trackUser(message.source.userId);
				console.log('sending:', pingCards[0]);
				const extraMessages = demoSwitch ? [pingCarousel] : [];
				return await lineAPI.reply({
					replyToken: message.replyToken,
					messages: [
						{
							type: 'text',
							text: 'Welcome to Catalyst! Please select a message from the catalog or provide a custom message in the format {MESSAGE}.{LOCATION}',
						},
						...extraMessages,
					],
				});
			})
		);
		console.log('follow repsonses: ', followReps);

		console.log('Processing postbacks: ', postbackQ.length);
		const postbackResp = await Promise.all(
			postbackQ.map(async (message) => {
				return stub.storePostback(message);
			})
		);

		const extraMessages = demoSwitch ? [pingCarousel] : [];
		const postbackReplyResp = await Promise.all(
			postbackResp.map(async (resp) => {
				console.log('responding: ', resp);
				return lineAPI.reply({
					replyToken: resp.reply,
					messages: [
						{
							type: 'text',
							text: `Sent: ${resp.coords}`,
						},
						{
							type: 'text',
							text: 'Please select a message from the catalog or provide a custom message in the format {MESSAGE}.{LOCATION}',
						},
						...extraMessages,
					],
				});
			})
		);

		//const  id = c.env.LineBotState.idFromName("default")
		//const stub = c.env.LineBotState.get(id)
		console.log('returning 200');
		return c.status(200);
	} catch (err) {
		console.error("Error processing '/' route:", err);
		const message = err instanceof Error ? err.message : String(err);
		const stack = err instanceof Error && err.stack ? err.stack : undefined;
		return c.json({ error: message, stack }, 500);
	}
});

export default class LineBotWorker extends WorkerEntrypoint<Env> {
	async fetch(request: Request): Promise<Response> {
		return app.fetch(request, this.env, this.ctx);
	}
}
