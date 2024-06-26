import {DurableObject, WorkerEntrypoint} from "cloudflare:workers"
import {Env} from "../worker-configuration"
export {LineBotState} from "./do"
import {Hono} from "hono"
import {LineBotState} from "./do"
import { createYoga } from "graphql-yoga";
import gqlSchema from "./graphql"
import {createRemoteJWKSet, jwtVerify} from "jose"
import { generate, count } from "random-words";
// @ts-ignore
import { Buffer } from 'node:buffer';
import {
	LinebotEvent,
	LinebotSendMessages,
	LinebotMessageEvent,
	LinebotUnfollowEvent,
	LinebotFollowEvent,
	pingCards, pingCarousel, LinebotPostbackEvent
} from './types';
import { LineAPI} from './line';

function safeCompare(a: Buffer, b: Buffer): boolean {
	if (a.length !== b.length) {
		return false;
	}
	// @ts-ignore
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
	CATALYST_JWK_URL: string
	CATALYST_APP_ID: string
	RAPID_API_KEY: string
}

type Variables = {
	valid: boolean
}

const app: Hono<{Bindings: bindings, Variables: Variables}> = new Hono()
app.use("/graphql", async (c) => {
	const JWKS = createRemoteJWKSet(new URL(c.env.CATALYST_JWK_URL))
	const token = c.req.header("Authorization") ? c.req.header("Authorization")!.split(" ")[1] : ""
	let valid = false
	try {
		const { payload, protectedHeader } = await jwtVerify(token, JWKS)
		valid = payload.claims != undefined && (payload.claims as string[]).includes(c.env.CATALYST_APP_ID)
	} catch (e) {
		console.error("error validating jwt: ", e)
		valid = false
	}
	c.set('valid', valid)
	const yoga = createYoga({
		schema: gqlSchema,
		graphqlEndpoint: "/graphql",
	  });
	  console.log("graphql handler")
	  return yoga.handle(c.req.raw as Request, c);
})

app.use('/', async (c) => {
	const lineAPI = new LineAPI(c.env.LINE_CHANNEL_TOKEN)
	const id = c.env.LineBotState.idFromName("default")
	const stub = c.env.LineBotState.get(id)
	// set/disable alarm first thing - sets to value of demo
	const demoSwitch = c.env.DEMO_ACTIVE === "true" ? true : false
	const alarmVal = await stub.alarmInit(demoSwitch)
	if (!demoSwitch) {
		await stub.removeAllUsers()
	}
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
	let postbackQ: LinebotPostbackEvent[] = []
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

		const {success: postbackSuccess, data: postBackData} = LinebotPostbackEvent.safeParse(event)
		if (postbackSuccess && postBackData) {
			postbackQ.push(postBackData)
		}

	})

	console.log("message queues created: ", followQ.length, unfollowQ.length, messagesQ.length)

	console.log("processing messages")
	const msgResps = await Promise.all(messagesQ.map(async (message) => {
		if (message.message && demoSwitch) {
			console.log("doing geolookup for ", message.message)
			// if message follows format then try and create ping out of it
			const elems = message.message.text.split(".").filter(element => element.replace(" ","").length > 0)
			console.log(elems)
			if (elems.length > 1) {
				const msg = elems[0]
				const locq = elems[1]
				console.log("doing geo query")
				const resp = await fetch('https://maptoolkit.p.rapidapi.com/geocode/search?' + new URLSearchParams({
					q: locq,
					countrycodes: 'TW,US',
					language: 'en',
					limit: '1'
				}),
					{
						method: "GET",
						headers: {
							'X-RapidAPI-Key': c.env.RAPID_API_KEY,
							'X-RapidAPI-Host': 'maptoolkit.p.rapidapi.com'
						}
					})

				const jsonBody = await resp.json<{
					lat: string,
					lon: string,
					display_name: string,
					address: {
						neighbourhood: string,
						suburb: string,
						village: string,
						city: string,
						country: string,
						postcode: string
					}
				}[]>()

				console.log(jsonBody)
				if (jsonBody.length > 0) {
					const random = generate({
						exactly: 3,
						wordsPerString: 1,
						formatter: (word) => word.toUpperCase(),
						join: "_"
					})
					const replyMessage = await stub.storePingEvent({
						title: msg,
						city: `${jsonBody[0].address.neighbourhood}, ${jsonBody[0].address.suburb}, ${jsonBody[0].address.village}, ${jsonBody[0].address.city}`,
						latlong: `${jsonBody[0].lat}, ${jsonBody[0].lon}`,
						randomPhrase: random,
						expiry: 0 // this is overwritten in the DO
					})

					await lineAPI.reply({
						replyToken: message.replyToken,
						messages: [
							{
								type: "text",
								text: replyMessage.coords
							},
						]
					})
				} else {
					await lineAPI.reply({
						replyToken: message.replyToken,
						messages: [
							{
								type: "text",
								text: `Unable to geolocate from message \"${message.message.text}\"`
							},
						]
					})
				}
			}
		}
		const extraMessages = demoSwitch ? [pingCarousel] : []
		return lineAPI.reply({
			replyToken: message.replyToken,
			messages: [
				{
					type: "text",
					text: demoSwitch ? "Please select a message from the catalog" : "Hello Friend"
				},
				...extraMessages
			]
		})
	}))
	console.log("responses:", JSON.stringify(msgResps))

	console.log("processing unfollows")
	await Promise.all(unfollowQ.map(async (message) => {
		return stub.removeUser(message.source.userId)
	}))


	const welcomeMsg = `Welcome to Catalyst, ${demoSwitch ? "the demo is currently in progress.":"nothing to see here yet."}`
	console.log("processing follows", welcomeMsg)
	const followReps = await Promise.all(followQ.map(async (message) => {
		await stub.trackUser(message.source.userId)
		console.log("sending:", pingCards[0])
		const extraMessages = demoSwitch ? [pingCarousel] : []
		return await lineAPI.reply({
			replyToken: message.replyToken,
			messages: [
				{
					type: "text",
					text: welcomeMsg
				},
				...extraMessages
			]
		})
	}))
	console.log("follow repsonses: ", followReps)

	console.log("processing postbacks")
	const postbackResp = await Promise.all(postbackQ.map(async (message) => {
		return stub.storePostback(message)
	}))
	const postbackReplyResp = await Promise.all(postbackResp.map(async (resp) => {
		console.log("responding: ", resp)
		return lineAPI.reply({
			replyToken: resp.reply,
			messages: [
				{
					type: "text",
					text: `Sent: ${resp.coords}`
				},
			]
		})
	}))

	//const  id = c.env.LineBotState.idFromName("default")
	//const stub = c.env.LineBotState.get(id)
	console.log("returning 200")
	return c.status( 200)
})

export default class LineBotWorker extends WorkerEntrypoint<Env>{
	async fetch(request: Request): Promise<Response> {
		return app.fetch(request, this.env, this.ctx)
	}
};
