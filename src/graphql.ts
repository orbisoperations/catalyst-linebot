import { createSchema } from 'graphql-yoga';
import { Context } from 'hono';
import { PingEvent, LineBotState, getLineBotStateSingleton } from './state';
import { Env } from './types';

const typeDefs = `
type LinePing {
    city: String!
    lat: String
    lon: String!
    expiry: Float!
    title: String!
	from: String!
    UID: String!
}

type Query {
    pings: [LinePing!]!
    _sdl: String!
}
`;

const env = Env.parse(process.env);

export default createSchema({
	typeDefs: typeDefs,
	resolvers: {
		Query: {
			pings: async (_, {}) => {
				// TODO: Remove demo switch. Don't know why it's a thing.
				const demoSwitch = env.DEMO_ACTIVE === 'true' ? true : false;
				if (!demoSwitch) return [];
				const linebotState: LineBotState = getLineBotStateSingleton(env);
				const pings: PingEvent[] = await linebotState.getPostbackData();
				return pings.map((ping) => {
					const latlon = ping.latlong.replace(' ', '').split(',');
					return {
						city: ping.city,
						title: ping.title,
						lat: latlon[0],
						lon: latlon[1],
						expiry: ping.expiry,
						UID: ping.randomPhrase,
						from: ping.from,
					};
				});
			},
			_sdl: () => typeDefs,
		},
	},
});
