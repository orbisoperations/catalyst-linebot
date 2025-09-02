import { z } from 'zod';
import { generate } from 'random-words';

// ---------------- Message payload types ----------------
const LineTextMessagePayload = z.object({
	type: z.literal('text'),
	id: z.string(),
	quoteToken: z.string(),
	text: z.string(),
});

const LineLocationMessagePayload = z.object({
	type: z.literal('location'),
	id: z.string(),
	latitude: z.number(),
	longitude: z.number(),
	address: z.string(),
});

// ---------------- Event wrapper ----------------

export const LinebotMessageEvent = z.object({
	type: z.literal('message'), // LINE always sends "message" for both text & location
	message: z.union([LineTextMessagePayload, LineLocationMessagePayload]),
	webhookEventId: z.string(),
	deliveryContext: z.object({
		isRedelivery: z.boolean(),
	}),
	timestamp: z.number(),
	source: z.object({
		type: z.enum(['user']),
		userId: z.string(),
	}),
	replyToken: z.string(),
	mode: z.enum(['active']),
});

export type LinebotMessageEvent = z.infer<typeof LinebotMessageEvent>;

export const LinebotUnfollowEvent = z.object({
	type: z.enum(['unfollow']),
	mode: z.enum(['active']),
	timestamp: z.number(),
	source: z.object({
		type: z.enum(['user']),
		userId: z.string(),
	}),
	webhookEventId: z.string(),
	deliveryContext: z.object({
		isRedelivery: z.boolean(),
	}),
});

export type LinebotUnfollowEvent = z.infer<typeof LinebotUnfollowEvent>;

export const LinebotFollowEvent = z.object({
	replyToken: z.string(),
	type: z.enum(['follow']),
	mode: z.enum(['active']),
	timestamp: z.number(),
	source: z.object({
		type: z.enum(['user']),
		userId: z.string(),
	}),
	webhookEventId: z.string(),
	deliveryContext: z.object({
		isRedelivery: z.boolean(),
	}),
	follow: z.object({
		isUnblocked: z.boolean(),
	}),
});

export type LinebotFollowEvent = z.infer<typeof LinebotFollowEvent>;

export const LinebotPostbackEvent = z.object({
	replyToken: z.string(),
	type: z.enum(['postback']),
	mode: z.enum(['active']),
	webhookEventId: z.string(),
	deliveryContext: z.object({
		isRedelivery: z.boolean(),
	}),
	timestamp: z.number(),
	source: z.object({
		type: z.enum(['user']),
		userId: z.string(),
	}),
	postback: z.object({
		data: z.string(),
	}),
});

export type LinebotPostbackEvent = z.infer<typeof LinebotPostbackEvent>;

export const LinebotEvent = z.object({
	destination: z.string(),
	events: z.union([LinebotMessageEvent, LinebotUnfollowEvent, LinebotFollowEvent, LinebotPostbackEvent]).array(),
});

export type LinebotEvent = z.infer<typeof LinebotEvent>;

const LineBotTextMessage = z.object({
	type: z.literal('text'),
	text: z.string(),
});

const button = z.object({
	type: z.literal('button'),
	style: z.literal('primary'),
	action: z.object({
		type: z.literal('postback'),
		label: z.literal('Send'),
		data: z.string(),
		displayText: z.literal('Send').optional(),
	}),
});

const box = z.object({
	type: z.literal('box'),
	layout: z.literal('horizontal').or(z.literal('vertical')),
	contents: z
		.union([
			z.object({
				type: z.literal('text'),
				text: z.string(),
			}),
			button,
		])
		.array(),
});

const bubble = z.object({
	type: z.literal('bubble'),
	body: box,
	footer: box.optional(),
});

const carousel = z.object({
	type: z.literal('carousel'),
	contents: bubble.array(),
});

const LineBotFlexMessage = z.object({
	type: z.literal('flex'),
	altText: z.string(),
	contents: bubble.or(carousel),
});

export const LinebotSendMessages = z.object({
	replyToken: z.string().optional(),
	to: z.string().optional(),
	messages: z.union([LineBotTextMessage, LineBotFlexMessage]).array(),
});

export type LinebotSendMessages = z.infer<typeof LinebotSendMessages>;

const newPingCoord = (title: string, cityName: string, coords: string) => {
	return LineBotFlexMessage.parse({
		type: 'flex',
		altText: 'Interactive Notification',
		contents: {
			type: 'bubble', // 1
			body: {
				// 2
				type: 'box', // 3
				layout: 'vertical', // 4
				contents: [
					// 5
					{
						type: 'text', // 6
						text: title,
					},
					{
						type: 'text', // 6
						text: cityName,
					},
					{
						type: 'text', // 6
						text: coords,
					},
				],
			},
		},
	});
};

const newPingCarousel = (coords: { title: string; cityName: string; coords: string }[]) => {
	const bubbles = coords.map((coord) => {
		const random = generate({
			exactly: 3,
			wordsPerString: 1,
			formatter: (word) => word.toUpperCase(),
			join: '__',
		});
		return {
			type: 'bubble', // 1
			body: {
				// 2
				type: 'box', // 3
				layout: 'vertical', // 4
				contents: [
					{
						type: 'text', // 6
						text: coord.title,
					},
					{
						type: 'text', // 6
						text: coord.cityName,
					},
					{
						type: 'text', // 6
						text: `UID: ${random}`,
					},
					{
						type: 'text', // 6
						text: coord.coords,
					},
					{
						type: 'button',
						action: {
							type: 'postback',
							label: 'Send',
							data: new URLSearchParams({
								title: coord.title,
								city: coord.cityName,
								latlong: coord.coords.replace(' ', ''),
								randomPhrase: random,
							}).toString(),
						},
						style: 'primary',
					},
				],
			},
		};
	});

	return LineBotFlexMessage.parse({
		type: 'flex',
		altText: 'test',
		contents: {
			type: 'carousel',
			contents: bubbles,
		},
	});
};

export const pingCards = [
	newPingCoord('Ping 1', 'Kinmen Island', '24.42695125386981, 118.22488092750645'),
	newPingCoord('Ping 2', 'Taipei', '25.033916607697982, 121.565390818944'),
	newPingCoord('Ping 3', 'Kaohsuing', '22.76081208289122, 120.24882050572171'),
];

export const pingCarousel = newPingCarousel([
	{ title: 'Ping 1', cityName: 'Kinmen Island', coords: '24.42695125386981, 118.22488092750645' },
	{ title: 'Ping 2', cityName: 'Taipei', coords: '25.033916607697982, 121.565390818944' },
	{ title: 'Ping 3', cityName: 'Kaohsuing', coords: '22.76081208289122, 120.24882050572171' },
]);
