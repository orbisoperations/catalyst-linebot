import { LinebotSendMessages } from './types';

export class LineAPI {
	headers
	baseUrl = "https://api.line.me"
	constructor(accessToken: string) {
		this.headers = {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		}
	}

	async reply(replyBody: LinebotSendMessages) {
		return await fetch(
			`${this.baseUrl}/v2/bot/message/reply`, {
				method: "POST",
				headers: this.headers,
				body: JSON.stringify(replyBody)
			}
		)
	}

	async push(messageBody: LinebotSendMessages) {
		return await fetch(
			`${this.baseUrl}/v2/bot/message/push`, {
				method: "POST",
				headers: this.headers,
				body: JSON.stringify(messageBody)
			}
		)
	}
}
