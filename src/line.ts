import { LinebotSendMessages } from './types';

export class LineAPI {
	headers;
	baseUrl = 'https://api.line.me';
	constructor(accessToken: string) {
		this.headers = {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
		};
	}

	async reply(replyBody: LinebotSendMessages) {
		console.log('Line message reply:', JSON.stringify(replyBody));
		try {
			const resp = await fetch(`${this.baseUrl}/v2/bot/message/reply`, {
				method: 'POST',
				headers: this.headers,
				body: JSON.stringify(replyBody),
			});

			if (!resp.ok) {
				// Capture LINE error payload (usually JSON) for diagnostics
				const errText = await resp.text();
				console.error('LINE /reply returned non-OK status', resp.status, errText);
			}

			return resp;
		} catch (err) {
			console.error('LINE /reply network error', err);
			throw err;
		}
	}

	async push(messageBody: LinebotSendMessages) {
		console.log('Line message push:', JSON.stringify(messageBody));
		try {
			const resp = await fetch(`${this.baseUrl}/v2/bot/message/push`, {
				method: 'POST',
				headers: this.headers,
				body: JSON.stringify(messageBody),
			});

			if (!resp.ok) {
				const errText = await resp.text();
				console.error('LINE /push returned non-OK status', resp.status, errText);
			}

			return resp;
		} catch (err) {
			console.error('LINE /push network error', err);
			throw err;
		}
	}
}
