import { DurableObject } from 'cloudflare:workers';
import {Env} from '../worker-configuration';
import { LineAPI} from './line';
import { LinebotPostbackEvent, pingCards } from './types';


const LOOP_S = 30
export interface PingEvent {
	title: string
	city: string
	latlong: string
	randomPhrase: string
	expiry: number
}
export class LineBotState extends DurableObject<Env> {

	async alarmInit(enabled: boolean) {
		if (enabled) {
			const  currentAlarm = await this.ctx.storage.getAlarm();
			if (currentAlarm == null) {
				await this.ctx.storage.setAlarm(Date.now() + (LOOP_S * 1000)) // 30 seconds
			}
		} else {
			await this.ctx.storage.deleteAlarm()
		}
		return this.ctx.storage.getAlarm()
	}
	async alarm() {
		const users = await this.ctx.storage.get<string[]>("users")?? []
		const pings = await this.getPostbackData()
		console.log(pings)
		// INSERT DATA GETTING FOR LINE USERS
		// THIS ALARM WILL TRIGGER EVER 10S
		// and currently just sends Ping
		const lineAPI = new LineAPI(this.env.LINE_CHANNEL_TOKEN)
		console.log("tracked user loop", users)
		const messages = pings.map((ping, index) => {
			return `${ping.randomPhrase}: \n\t Coordinates: ${ping.latlong} \n\texpires in: ${(ping.expiry - Date.now())/1000}s`
		})

		if (pings.length > 0) {
			const message = `Summary of Current Events: \n${messages.join(" \n")}`
			const reps = await Promise.all(Array.from(users).map(async (user) => {
				return lineAPI.push({
					to: user,
					messages: [{
						type: "text",
						text: message
					}]
				})
			}))
			console.log(reps)
		}
		// reset alarm
		await this.ctx.storage.setAlarm(Date.now() + (LOOP_S * 1000)) // 100 seconds
	}
	async trackUser(userId: string) {
		let users = await this.ctx.storage.get<string[]>("users")?? []
		const newUserList = [...Array.from(users), userId]
		await this.ctx.storage.put("users", newUserList)
	}

	async removeUser(userId: string) {
		let users: string [] = await this.ctx.storage.get<string[]>("users")?? []
		const newUserList = Array.from(users).filter(user => user != userId)
		await this.ctx.storage.put("users", newUserList)
	}

	async removeAllUsers() {
		console.log("removing all users from demo")
		await this.ctx.storage.put("users", [])
	}

	async storePostback(msg: LinebotPostbackEvent) {
		console.log("storing ping")
		await this.ctx.blockConcurrencyWhile(async () => {
			const pings = await this.ctx.storage.get<PingEvent[]>("pings") ?? []
			const searchParams = new URLSearchParams(msg.postback.data);
			pings.push({
				latlong: searchParams.has("latlong") ? searchParams.get("latlong")! : "no latlong provided",
				expiry: (Date.now() + (1 * 60 * 1000)), // 1m x 60s x 1000ms,
				city: searchParams.has("city") ? searchParams.get("city")! : "no city provided",
				title: searchParams.has("title") ? searchParams.get("title")! : "no title provided",
				randomPhrase: searchParams.has("randomPhrase") ? searchParams.get("randomPhrase")! : "no UID provided"
			})
			console.log(pings)
			await this.ctx.storage.put("pings", pings)
		})
		console.log("post ping storing")
		return {
			reply: msg.replyToken,
			coords: msg.postback.data
		}
	}

	async getPostbackData(): Promise<PingEvent[]> {
		const pings = await this.ctx.storage.get<PingEvent[]>("pings") ?? []
		const now = Date.now()
		const validPings  = pings.filter(ping => ping.expiry > now)
		await this.ctx.storage.put("pings", validPings)
		return validPings
	}
}
