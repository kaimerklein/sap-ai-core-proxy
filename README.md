# Simple Prototype of a proxy for AI Core

## Purpose

The idea is to run this proxy locally. It can receive requests created by any LLM frontend under http://localhost:3001 and forwards them to AI Core.

This allows to use tools like e.g. Open WebUI or Autogen with no adjustments for calling an LLM on AI Core. Only the base URL for the OpenAI client library needs to be set.

### Usage example: AutoGen

AutoGen Repo: https://github.com/microsoft/autogen

#### OpenAI flavor

```python
config_list=[{
    "model": "gpt-4",
    "api_key": "NotRequired",
    "base_url": "http://localhost:3001/",
    "price": [0, 0]
}]
```

#### Azure Flavor

```python
config_list=[{
    "model": "AI_CORE_DEPLOYMENT_ID"
    "api_key": "NotRequired",
    "base_url": "http://localhost:3001/",
    "price": [0, 0]
}]
```

### Usage example: Open WebUI

Open WebUI Repo: https://github.com/open-webui/open-webui

Provide following environment variables:

- OPENAI_API_BASE_URLS
- OPENAI_API_KEYS

Ensure that `--add-host=host.docker.internal:host-gateway` is passed to `docker run`.

```bash
docker run -d -p 3000:8080 -e OPENAI_API_BASE_URLS="http://host.docker.internal:3001" -e OPENAI_API_KEYS="NONE" -v open-webui:/app/backend/data --name open-webui --add-host=host.docker.internal:host-gateway --restart always ghcr.io/open-webui/open-webui:main
```

### Usage example Microsoft Magentic Multi-Agent System

Follow Instructions in their [github repo](https://github.com/microsoft/autogen/tree/main/python/packages/autogen-magentic-one).

**Hint:** Additionally, navigate to the folders `python/packages/autogen-core` and `python/packages/autogen-ext`, in both execute `pip install .`
In `python/packages/autogen-ext` also `pip install docker`.

Provide your AI Core credentials as per [AI Core Credentials](#ai-core-credentials) tart the proxy with `npm run dev`, make the following settings in the shell where you want to execute magentic:

``` bash
export CHAT_COMPLETION_PROVIDER='openai'

export CHAT_COMPLETION_KWARGS_JSON='{                             
  "api_key": "NONE",
  "base_url": "http://localhost:3001",
  "model": "gpt-4o"
}'
```

Start magentic, e.g. the example with `python examples/example.py --logs_dir ./my_logs --save_screenshots`

### Usage Example for atomic-agents

Follow instructions on their [github repo](https://github.com/BrainBlend-AI/atomic-agents)

**Hint:** you might need to install [poetry](https://python-poetry.org/docs/#installation) if you don't have it yet.

Provide your AI Core credentials as per [AI Core Credentials](#ai-core-credentials) tart the proxy with `npm run dev`, make the following settings in the shell where you want to execute magentic:

In the shell for atomic agents set the following environment variables

``` bash
export OPENAI_BASE_URL=http://localhost:3001  

export OPENAI_API_KEY=NONE   
```

Your ready to start their example.

## AI Core Credentials

You need an AI Core Instance with running deployments of OpenAI compatible LLMs in generative AI Hub.

Find your key for the service binding on BTP and copy and paste it in JSON format to the file **`.creds.json`** in the project root (where also this README.md lives).

```JSON
{
    "serviceurls": {
        "AI_API_URL": "https://api.ai.internalprod.eu-central-1.aws.ml.hana.ondemand.com"
    },
    "appname": "OPTIONAL",
    "clientid": "YOUR_CLIENT_ID",
    "clientsecret": "YOUR_CLIENT_SECRET",
    "identityzone": "OPTIONAL",
    "identityzoneid": "OPTIONAL",
    "url": "AUTHORIZATION_URL"
}
```

## Run it

First of all, clone the repo and run `npm install`. Make sure you have created a `.creds.json` file as described above.

To start the proxy, use `npm run dev`

OR

Build with `npm run build`and thereafter use `npm run start`

## What does it do?

Proxy server that acts as an intermediary between client requests and an AI Core service. It performs the following main functions:

1. **Authentication**: Fetches an authentication token using client credentials.

2. **Model Deployment Retrieval**: Retrieves a list of deployed AI models from the AI Core service.

3. **Request Handling**:

   - Intercepts incoming HTTP requests.
   - Processes and rewrites requests to match AI Core's API format.
   - Forwards modified requests to the AI Core service.

4. **OpenAI API Emulation**:

   - Provides an endpoint (`/models`) that emulates OpenAI's model listing API.
   - Maps AI Core deployments to OpenAI-compatible model formats.

5. **Response Forwarding**: Forwards AI Core's responses back to the client.

The server is designed to translate and proxy requests between clients expecting an OpenAI-like API and the actual AI Core service, allowing for seamless integration of AI Core capabilities into applications expecting OpenAI-compatible endpoints.

## When you don't have nodejs

Try, for instance, [google](http://google.com?q=how%20t%20install%20nodejs%20and%20npm) to find out how to install it 😉
