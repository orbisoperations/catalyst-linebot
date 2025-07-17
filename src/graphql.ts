import { createSchema } from 'graphql-yoga';
import { Context } from 'hono';
import { PingEvent, LineBotState } from './do';

const typeDefs = `
type LinePing {
    city: String!
    lat: String
    lon: String!
    expiry: Float!
    title: String!
    UID: String!
}

type Query {
    pings: [LinePing!]!
    _sdl: String!
}
`;
export default createSchema({
	typeDefs: typeDefs,
	resolvers: {
		Query: {
			pings: async (_, {}, c: Context) => {
				const demoSwitch = c.env.DEMO_ACTIVE === 'true' ? true : false;
				if (!demoSwitch || !Boolean(c.get('valid'))) return [];
				const id = c.env.LineBotState.idFromName('default');
				const stub: DurableObjectStub<LineBotState> = c.env.LineBotState.get(id);
				const pings: PingEvent[] = await stub.getPostbackData();

				return pings.map((ping) => {
					const latlon = ping.latlong.replace(' ', '').split(',');
					return {
						city: ping.city,
						title: ping.title,
						lat: latlon[0],
						lon: latlon[1],
						expiry: ping.expiry,
						UID: ping.randomPhrase,
					};
				});
			},
			_sdl: () => typeDefs,
		},
	},
});
