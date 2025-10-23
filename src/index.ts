import { Hono } from 'hono';
import { getLineBotStateSingleton } from './state';
import type { LineBotState } from './state';
import { createYoga } from 'graphql-yoga';
import gqlSchema from './graphql';
import { generate } from 'random-words';
// @ts-ignore
import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
	LinebotEvent,
	LinebotMessageEvent,
	LinebotUnfollowEvent,
	LinebotFollowEvent,
	pingCards,
	pingCarousel,
	LinebotPostbackEvent,
	Env,
} from './types';
import { LineAPI } from './line';
import { verifyJwtWithRemoteJwks } from './auth/catalyst-jwt';

function safeCompare(a: Buffer, b: Buffer): boolean {
	if (a.length !== b.length) {
		return false;
	}
	return timingSafeEqual(a, b);
}

async function validateSignature(secret: string, body: string, signatureHeader?: string) {
	const digest = createHmac('sha256', secret).update(body).digest();
	const signature = Buffer.from(signatureHeader ?? '', 'base64');
	return safeCompare(digest, signature);
}

const env = Env.parse(process.env);
const app: Hono = new Hono();

app.use('/graphql', async (c) => {
	const header = c.req.header('Authorization');
	const splitValue = header?.split(' ');
	const token: string | undefined = splitValue?.[1];

	if (!token) {
		console.error('Unauthorized request: No token found in Authorization header');
		return c.json({ message: 'Catalyst token is required', code: 400 }, 400);
	}

	const validationResult = await verifyJwtWithRemoteJwks(token, env.CATALYST_JWT_ISSUER, env.CATALYST_APP_ID, env.CATALYST_JWK_URL);

	if (!validationResult.verified) {
		console.error('error verifying jwt: ', JSON.stringify(validationResult));

		if (validationResult.errorCode === 'JWT_VALIDATION_FAILED' || validationResult.errorCode === 'UNEXPECTED_JWT_VALIDATION_ERROR') {
			console.error('Internal JOSE Error validating jwt. Masking error to client.');
			return c.json({ message: 'Invalid JWT', code: 401 }, 401);
		}

		return c.json({ message: validationResult.message, code: 401 }, 401);
	}

	const yoga = createYoga({
		schema: gqlSchema,
		graphqlEndpoint: '/graphql',
	});

	console.log('graphql handler');
	return yoga.handle(c.req.raw);
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

async function geocodeLocation(locq: string): Promise<GeocodeResult[]> {
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
	lineBotState,
}: {
	message: LinebotMessageEvent;
	lineBotState: LineBotState;
}): Promise<LineReplyText | null> {
	if (message.message.type !== 'location') return null;

	const random = generate({ exactly: 3, wordsPerString: 1, formatter: (w) => w.toUpperCase(), join: '_' });

	const pingEvent = await lineBotState.storePingEvent({
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
	lineBotState,
}: {
	message: LinebotMessageEvent;
	lineBotState: LineBotState;
}): Promise<LineReplyText | null> {
	// Format expected: TITLE.LOCATION
	if (message.message.type !== 'text') return null;
	const elems = message.message.text.split('.').filter((e) => e.replace(' ', '').length > 0);
	if (elems.length < 2) return null;

	const [title, locq] = elems;

	let jsonBody: GeocodeResult[] = [];

	if (!locq) {
		console.error('No location found in message');
		return null;
	}

	try {
		jsonBody = await geocodeLocation(locq);
	} catch (err) {
		console.error('Error geocoding location: ', err);
		return null;
	}

	if (jsonBody.length === 0) return null;

	const random = generate({ exactly: 3, wordsPerString: 1, formatter: (w) => w.toUpperCase(), join: '_' });

	const pingEvent = await lineBotState.storePingEvent({
		title: title || 'Unknown',
		city: `${jsonBody[0]?.address.neighbourhood}, ${jsonBody[0]?.address.suburb}, ${jsonBody[0]?.address.village}, ${jsonBody[0]?.address.city}`,
		latlong: `${jsonBody[0]?.lat}, ${jsonBody[0]?.lon}`,
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

		const lineAPI = new LineAPI(env.LINE_CHANNEL_TOKEN);
		const lineBotState = getLineBotStateSingleton({
			LINE_CHANNEL_TOKEN: env.LINE_CHANNEL_TOKEN,
			CATALYST_GATEWAY_URL: env.CATALYST_GATEWAY_URL,
			CATALYST_GATEWAY_TOKEN: env.CATALYST_GATEWAY_TOKEN,
		});
		// set/disable alarm first thing - sets to value of demo
		// Darrell here - I need to nuke this, but it should be another ticket. It's really nestled in the logic of this adapter.
		const demoSwitch = env.DEMO_ACTIVE === 'true' ? true : false;
		const alarmVal = await lineBotState.alarmInit(demoSwitch);

		console.log('Next alarm: ', alarmVal);

		// get on with chatbot stuff
		const body = await c.req.text();

		console.log('body', JSON.stringify(body));

		const valid = validateSignature(env.LINE_CHANNEL_SECRET, body, c.req.header('x-line-signature'));
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
							lineReplyMessage = (await handleLocationMessage({ message, lineBotState })) ?? undefined;
						} else if (message.message.type === 'text') {
							lineReplyMessage = (await handleTextMessage({ message, lineBotState })) ?? undefined;
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
				return lineBotState.removeUser(message.source.userId);
			})
		);

		console.log('Processing follows');
		const followReps = await Promise.all(
			followQ.map(async (message) => {
				await lineBotState.trackUser(message.source.userId);
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
				return lineBotState.storePostback(message);
			})
		);

		const extraMessages = demoSwitch ? [pingCarousel] : [];
		await Promise.all(
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

const server = Bun.serve({
	port: env.GRAPHQL_PORT,
	hostname: env.GRAPHQL_HOST,
	fetch: app.fetch,
});

console.info(`Server is running on ${new URL('/graphql', `http://${server.hostname}:${server.port}`)}`);
