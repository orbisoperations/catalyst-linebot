import {DurableObject, WorkerEntrypoint} from "cloudflare:workers"
import {Env} from "../worker-configuration"
export {LineBotState} from "./do"
import {Hono} from "hono"
import {LineBotState} from "./do"
import { Buffer } from 'node:buffer';
import {
	LinebotEvent,
	LinebotSendMessages,
	LinebotMessageEvent,
	LinebotUnfollowEvent,
	LinebotFollowEvent
} from './types';
import { LineAPI} from './line';
import { boolean } from 'zod';

function safeCompare(a: Buffer, b: Buffer): boolean {
	if (a.length !== b.length) {
		return false;
	}
	return crypto.subtle.timingSafeEqual(a, b);
}

async function validateSignature(secret: string, body: string, signatureHeader?: string) {
	//console.log("creating hmac functions")
	const encoder = new TextEncoder()
	const encodedKey = encoder.encode(secret)
	const encodedData = encoder.encode(body)
	const hmacKey = await crypto.subtle.importKey(
		'raw',
		encodedKey,
		{
			name: "HMAC",
			hash: "SHA-256"
		},
		true,
		['sign', 'verify']
	)

	const rawDigest = await crypto.subtle.sign(
		'HMAC',
		hmacKey,
		encodedData
	)
	const digest = Buffer.from(Buffer.from(rawDigest).toString("base64"))
	const signature = Buffer.from(signatureHeader?? "")
	//console.log(`digest: ${digest}`)
	//console.log(`signature: ${signature}`)
	const valid = safeCompare(digest, signature)
	return valid
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
	LineBotState: DurableObjectNamespace<LineBotState>
	LINE_CHANNEL_TOKEN: string
	LINE_CHANNEL_SECRET: string
	DEMO_ACTIVE: string
}
const app: Hono<{Bindings: bindings}> = new Hono()
app.use('/', async (c) => {
	const lineAPI = new LineAPI(c.env.LINE_CHANNEL_TOKEN)
	const id = c.env.LineBotState.idFromName("default")
	const stub = c.env.LineBotState.get(id)
	// set/disable alarm first thing - sets to value of demo
	const demoSwitch = c.env.DEMO_ACTIVE === "true" ? true : false
	const alarmVal = await stub.alarmInit(demoSwitch)
	console.log("next alarm: ", alarmVal)

	// get on with chatbot stuff
	const body = await c.req.text()
	console.log("body", JSON.parse(body))

	const valid = validateSignature(c.env.LINE_CHANNEL_SECRET, body, c.req.header("x-line-signature"))
	if (!valid) {
		// web hook response should always return 200
		console.error("invalid signature - ignoring message")
		return c.status(200)
	}

	console.log("message is valid")

	const event = LinebotEvent.parse(JSON.parse(body))

	let followQ: LinebotFollowEvent[] = []
	let unfollowQ: LinebotUnfollowEvent[] = []
	let messagesQ: LinebotMessageEvent[] = []
	event.events.forEach(event => {
			const { success: unfollowSuccess, data: unfollowData } = LinebotUnfollowEvent.safeParse(event)
			if (unfollowSuccess && unfollowData) {
				unfollowQ.push(unfollowData)
			}

		const { success: messageSuccess, data: messageData } = LinebotMessageEvent.safeParse(event)
		if (messageSuccess && messageData) {
			messagesQ.push(messageData)
		}

		const {success: followSuccess, data: followData} = LinebotFollowEvent.safeParse(event)
		if (followSuccess && followData) {
			followQ.push(followData)
		}

	})

	console.log("message queues created: ", followQ.length, unfollowQ.length, messagesQ.length)

	console.log("processing messages")
	const msgResps = await Promise.all(messagesQ.map(async (message) => {
		return lineAPI.reply({
			replyToken: message.replyToken,
			messages: [
				{
					type: "text",
					text: "Hello Friend!"
				}
			]
		})
	}))
	console.log("responses:", JSON.stringify(msgResps))

	console.log("processing unfollows")
	await Promise.all(unfollowQ.map(async (message) => {
		return stub.removeUser(message.source.userId)
	}))


	const welcomeMsg = `Welcome to Catalyst, ${c.env.DEMO_ACTIVE ? "the demo is currently in progress.":"nothing to see here yet."}`
	console.log("processing follows", welcomeMsg)
	const followReps = await Promise.all(followQ.map(async (message) => {
		await stub.trackUser(message.source.userId)
		return lineAPI.reply({
			replyToken: message.replyToken,
			messages: [
				{
					type: "text",
					text: welcomeMsg
				}
			]
		})
	}))
	console.log("follow repsonses: ", followReps)

	//const  id = c.env.LineBotState.idFromName("default")
	//const stub = c.env.LineBotState.get(id)
	console.log("returning 200")
	return c.status( 200)
})
export default class LineBotWorker extends WorkerEntrypoint<Env>{
	async fetch(request: Request): Promise<Response> {
		const resp = await app.fetch(request, this.env, this.ctx)
		console.log(JSON.stringify(resp))
		return new Response(null, {
			status: 200
		})
	}
};
