// NOTE: pour merger cette branche sur master et écraser master
// https://javaetmoi.com/2013/08/ecraser-une-branche-par-une-autre-avec-git/

// MUST be the very first import — ensures process.env.{DATABASE_URL,REDIS_URL,...}
// is populated before any module that reads them at top level (datasourcesredis.ts,
// firebase.ts, prisma client, etc.) gets evaluated.
import 'dotenv/config'

import { ApolloServer } from '@apollo/server';
import express from 'express';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
// import { createServer } from 'http';
import http from 'http';
import { makeExecutableSchema } from '@graphql-tools/schema';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import bodyParser from 'body-parser';
import cors from 'cors';
import { readFileSync } from 'fs';

import { applyMiddleware } from 'graphql-middleware'
import { permissions } from './permissions.js';
import { STATUS_CRON_ENABLED } from './config/AppConfig.js';
import { startCampaignStatusCron } from './jobs/campaignStatusCron.js';

import config from "config";
console.log(`server started on ${process.env.NODE_ENV} mode`);
process.env.port = config.get<string>('port');
const PORT = process.env.port || 4000 // default dev

// TODO: test this: read file that doesnt exist
// process.on('uncaughtException', err => {
//   console.log(`There was an uncaught error: ${err}`)
//   process.exit(1)
// })

import { GraphQLScalarType, Kind } from 'graphql';

const DateScalar = new GraphQLScalarType({
  name: 'Date',
  description: 'Date custom scalar type',
  serialize(value) {
    if (value instanceof Date) {
      return value.getTime(); // Convert outgoing Date to integer for JSON
    }
    throw Error('GraphQL Date Scalar serializer expected a `Date` object');
  },
  parseValue(value) {
    if (typeof value === 'number') {
      return new Date(value); // Convert incoming integer to Date
    }
    throw new Error('GraphQL Date Scalar parser expected a `number`');
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.INT) {
      // Convert hard-coded AST string to integer and then to Date
      return new Date(parseInt(ast.value, 10));
    }
    // Invalid hard-coded value (not an integer)
    return null;
  },
});

import { verifyToken } from './firebase.js'
import resolvers from "./resolvers/index.js";

const typeDefs = readFileSync('schema.graphql', { encoding: 'utf-8' }); // REVIEW: Error message (callback fct)

interface MyContext {
  userId?: string;
  roles?: string[];
  isAuthenticated: boolean;
  isAppToken?: boolean;
}

let schema = makeExecutableSchema({ typeDefs, resolvers });
// schema = applyMiddleware(schema, permissions)
schema = applyMiddleware(schema)

// Create an Express app and HTTP server; we will attach both the WebSocket
// server and the ApolloServer to this HTTP server.
const app = express();
const httpServer = http.createServer(app);

const wsServer = new WebSocketServer({
  server: httpServer,
  path: "/" // localhost:3000/
  // path: "/graphql" // localhost:3000/graphql
});

const serverCleanup = useServer({ schema }, wsServer);

// const server = new ApolloServer<MyContext>({
//   typeDefs,
//   resolvers,
//   plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
// });

const server = new ApolloServer<MyContext>({
  schema,
  plugins: [
    // Proper shutdown for the HTTP server.
    ApolloServerPluginDrainHttpServer({ httpServer }),
    {
      async serverWillStart() { // Proper shutdown for the WebSocket server
        return {
          async drainServer() {
            await serverCleanup.dispose();
          },
        };
      },
    },
  ],
});

await server.start();

// Set up our Express middleware to handle CORS, body parsing,
// and our expressMiddleware function.
app.use(
  '/',
  cors<cors.CorsRequest>(),
  bodyParser.json(),
  // expressMiddleware accepts the same arguments:
  // an Apollo Server instance and optional configuration options
  expressMiddleware(
    server,
    {
      context: async ({ req }): Promise<MyContext> => {
        const decodedToken = await verifyToken(req.headers.authorization as string | undefined)

        if (!decodedToken) {
          return { isAuthenticated: false }
        }

        const operationName = req.body?.operationName ?? 'anonymous'
        console.log(`[${operationName}] uid=${decodedToken.uid} email=${decodedToken.email ?? 'n/a'}`)

        return {
          userId: decodedToken.uid,
          roles: decodedToken.roles ?? [],
          isAuthenticated: true,
          isAppToken: decodedToken.isAppToken ?? false,
        }
      },
    })
);

await new Promise<void>((resolve) => httpServer.listen({ port: PORT }, resolve));
console.log(`🚀 Server ready at http://localhost:${PORT}/`);

if (STATUS_CRON_ENABLED) {
  startCampaignStatusCron();
} else {
  console.log('[statusCron] disabled (set STATUS_CRON_ENABLED=true in src/config/AppConfig.ts to enable)');
}