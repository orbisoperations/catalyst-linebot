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

export const LinebotSendMessages = z.object({
	replyToken: z.string().optional(),
	to: z.string().optional(),
	messages: z.object({
		type: z.enum(["text"]),
		text: z.string()
	}).array()
})

export type LinebotSendMessages = z.infer<typeof LinebotSendMessages>
