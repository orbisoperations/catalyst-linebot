import { createSchema } from "graphql-yoga";
import { Context } from "hono";
import {PingEvent, LineBotState} from "./do"

const typeDefs = `
type LinePing {
    city: String!
    lat: String!
    lon: String!
    expiry: Float!
    title: String!
    UID: String!
}

type Query {
    pings: [LinePing!]!
    _sdl: String!
}
`
export default createSchema({
    typeDefs: typeDefs,
    resolvers: {
        Query: {
            pings: async (_, {}, c: Context) => {
                const demoSwitch = c.env.DEMO_ACTIVE === "true" ? true : false
                if (!demoSwitch || !Boolean(c.get('valid'))) {
									console.error("unauthorized user returning empty array")
									return []
								}
                const id = c.env.LineBotState.idFromName("default")
                const   stub: DurableObjectStub<LineBotState> = c.env.LineBotState.get(id)
                const pings: PingEvent[] = await stub.getPostbackData()

								const videoEvents = await  stub.getVideoData()

								return [...pings.map(ping => {
									const latlon = ping.latlong.replace(" ","").split(",")
									return {
										city: ping.city,
										title: ping.title,
										lat: latlon[0],
										lon: latlon[1],
										expiry: ping.expiry,
										UID: ping.randomPhrase
									}
								}),
									... videoEvents.map(video => {
										return {
											city: video.location ?? "unknown",
											title: "Video Upload - " + video.link,
											lat: video.lat,
											lon: video.lon,
											expiry: video.expiry,
											UID: video.link
										}
									})]
            },
            _sdl: () => typeDefs
        }
    }
})
