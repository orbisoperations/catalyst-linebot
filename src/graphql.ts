import { createSchema } from "graphql-yoga";
import { Context } from "hono";
import {PingEvent, LineBotState} from "./do"

const typeDefs = `
type LinePing {
    label: String!
    location: String!
    lon: String!
    lat: String!
    message: String!
    expiry: Int!
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
                if (demoSwitch) return []
                const id = c.env.LineBotState.idFromName("default")
                const   stub: DurableObjectStub<LineBotState> = c.env.LineBotState.get(id)
                const pings: PingEvent[] = await stub.getPostbackData()
            },
            _sdl: () => typeDefs
        }
    }
})