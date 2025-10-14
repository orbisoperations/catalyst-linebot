#!/usr/bin/env bash

###
## This script is used to set the secrets for the app
## It is used in the CI/CD pipeline to set the secrets for the app
###

source .env

# check if the secrets exist in ENV
if [ -z "$RAPID_API_KEY" ]; then
  echo "RAPID_API_KEY is not set"
  exit 1
fi

if [ -z "$LINE_CHANNEL_TOKEN" ]; then
  echo "LINE_CHANNEL_TOKEN is not set"
  exit 1
fi

if [ -z "$LINE_CHANNEL_SECRET" ]; then
  echo "LINE_CHANNEL_SECRET is not set"
  exit 1
fi

if [ -z "$CATALYST_JWK_URL" ]; then
  echo "CATALYST_JWK_URL is not set"
  exit 1
fi

if [ -z "$CATALYST_GATEWAY_URL" ]; then
  echo "CATALYST_GATEWAY_URL is not set"
  exit 1
fi

if [ -z "$CATALYST_APP_ID" ]; then
  echo "CATALYST_APP_ID is not set"
  exit 1
fi

if [ -z "$CATALYST_GATEWAY_TOKEN" ]; then
  echo "CATALYST_GATEWAY_TOKEN is not set"
  exit 1
fi

if [ -z "$CATALYST_JWT_ISSUER" ]; then
  echo "CATALYST_JWT_ISSUER is not set"
  exit 1
fi

if [ -z "$DEMO_ACTIVE" ]; then
  echo "DEMO_ACTIVE is not set"
  exit 1
fi

# set the secrets
fly secrets set RAPID_API_KEY=$RAPID_API_KEY LINE_CHANNEL_TOKEN=$LINE_CHANNEL_TOKEN LINE_CHANNEL_SECRET=$LINE_CHANNEL_SECRET CATALYST_JWK_URL=$CATALYST_JWK_URL CATALYST_GATEWAY_URL=$CATALYST_GATEWAY_URL CATALYST_APP_ID=$CATALYST_APP_ID CATALYST_GATEWAY_TOKEN=$CATALYST_GATEWAY_TOKEN CATALYST_JWT_ISSUER=$CATALYST_JWT_ISSUER DEMO_ACTIVE=$DEMO_ACTIVE
