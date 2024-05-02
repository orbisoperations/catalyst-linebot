import {z} from "zod"

export const LinebotMessageEvent = z.object({
	type: z.enum(["message"]),
	message: z.object({
		type: z.enum(["text"]),
		id: z.string(),
		quoteToken: z.string(),
		text: z.string()
	}).optional(),
	webhookEventId: z.string(),
	deliveryContext: z.object({
		isRedelivery: z.boolean()
	}),
	timestamp: z.number(),
	source: z.object({
		type: z.enum(["user"]),
		userId: z.string()
	}),
	replyToken: z.string(),
	mode: z.enum(["active"])
})

export type LinebotMessageEvent = z.infer<typeof LinebotMessageEvent>

export const LinebotUnfollowEvent = z.object({
	type: z.enum(["unfollow"]),
	mode: z.enum(["active"]),
	timestamp: z.number(),
	source: z.object({
		type: z.enum(["user"]),
		userId: z.string()
	}),
	webhookEventId: z.string(),
	deliveryContext: z.object({
		isRedelivery: z.boolean()
	})
})

export type LinebotUnfollowEvent = z.infer<typeof LinebotUnfollowEvent>

export const LinebotFollowEvent = z.object({
	replyToken: z.string(),
	type: z.enum(["follow"]),
	mode: z.enum(["active"]),
	timestamp: z.number(),
	source: z.object({
		type: z.enum(["user"]),
		userId: z.string()
	}),
	webhookEventId: z.string(),
	deliveryContext: z.object({
		isRedelivery: z.boolean()
	}),
	follow: z.object({
		isUnblocked: z.boolean()
	})
})

export type LinebotFollowEvent = z.infer<typeof LinebotFollowEvent>

export const LinebotEvent = z.object({
	destination: z.string(),
	events: z.union([LinebotMessageEvent, LinebotUnfollowEvent, LinebotFollowEvent]).array()
})

export type LinebotEvent = z.infer<typeof LinebotEvent>


const LineBotTextMessage = z.object({
		type: z.literal("text"),
		text: z.string()
})

const LineBotFlexMessage = z.object({
	type: z.literal("flex"),
	altText: z.string(),
	contents: z.object({
		type: z.literal("bubble"),
		body: z.object({
			type: z.literal("box"),
			layout: z.literal("horizontal").or(z.literal("vertical")),
			contents: z.object({
				type: z.literal("text"),
				text: z.string()
			}).array()
		})
	})
})
export const LinebotSendMessages = z.object({
	replyToken: z.string().optional(),
	to: z.string().optional(),
	messages: z.union([
		LineBotTextMessage,
		LineBotFlexMessage
	]).array()
})


export type LinebotSendMessages = z.infer<typeof LinebotSendMessages>

const newPingCoord = (
	title: string,
	cityName: string,
	coords: string
) => {
	return LineBotFlexMessage.parse({
		type: "flex",
		altText: "Interactive Notification",
		contents:
			{
				"type": "bubble", // 1
				"body": {
					// 2
					"type": "box", // 3
					"layout": "vertical", // 4
					"contents": [
						// 5
						{
							"type": "text", // 6
							"text": title
						},
						{
							"type": "text", // 6
							"text": cityName
						},
						{
							"type": "text", // 6
							"text": coords
						}
					]
				}
			}
	})
}

export const pingCards = [
	newPingCoord("Ping 1", "Kinmen Island", "24.42695125386981, 118.22488092750645"),
	newPingCoord("Ping 2", "Taipei", "25.033916607697982, 121.565390818944"),
	newPingCoord("Ping 3", "Kaohsuing", "22.76081208289122, 120.24882050572171")
]
