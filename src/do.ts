import { DurableObject } from 'cloudflare:workers';
import {Env} from '../worker-configuration';
import { LineAPI} from './line';

export class LineBotState extends DurableObject<Env> {

	async alarmInit(enabled: boolean) {
		if (enabled) {
			const  currentAlarm = await this.ctx.storage.getAlarm();
			if (currentAlarm == null) {
				await this.ctx.storage.setAlarm(Date.now() + 10 * 1000) // 10 seconds
			}
		} else {
			await this.ctx.storage.deleteAlarm()
		}
		return this.ctx.storage.getAlarm()
	}
	async alarm() {
		const users = await this.ctx.storage.get<string[]>("users")?? []

		// INSERT DATA GETTING FOR LINE USERS
		// THIS ALARM WILL TRIGGER EVER 10S
		// and currently just sends Ping
		const lineAPI = new LineAPI(this.env.LINE_CHANNEL_TOKEN)
		console.log("users", users)
		await Promise.all(Array.from(users).map(async (user) => {
			return lineAPI.push({
				to: user,
				messages: [
					{
						type: "text",
						text: "Ping from Catalyst"
					}
				]
			})
		}))
		// reset alarm
		await this.ctx.storage.setAlarm(Date.now() + 10 * 1000) // 10 seconds
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
}
