import * as http from "http";
import * as https from "https";
import { IncomingMessage, ServerResponse } from "http";
import { URL } from "url";
import axios, { AxiosResponse } from "axios";
import fs, { write } from "fs";

// TODO: Refactor!, Refactor!, Refactor!
// TODO: Replace fixed api-version by something more useful
// TODO: refresh token when expired
// TODO: can we somehow filter AI Core deployments for the response to the /models endpoint for OpenAI ones?
// TODO: provide Azure Library Compatibility under /azure/..., openai under /openai/... and so on

const WRITE_REQUESTS_TO_FILE = true

/* externalized credentials
Copy and paste from your AI Core service instance in the SAP BTP Cockpit
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
    
    */
const creds = require("../.creds.json") as Creds;

let deployments: Deployments = undefined as unknown as Deployments;
let token: string | undefined;

async function main() {
  const remoteServerUrl = creds.serviceurls?.AI_API_URL;

  token = await fetchTokenWithClientSecret(creds);

  console.log(`Token: ${token.slice(0, 30)}...`);

  //For testing in curl: write token to file
  const filename = "token.txt"
  fs.writeFileSync(filename, token);

  deployments = await getAICoreDeployments(creds.serviceurls.AI_API_URL, token, "default");

  // Create the HTTP server
  const server = http.createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      // Log incoming request details
      console.log(`Received: ${req.method} ${req.url}`);

      // Forward the request to the remote server
      handleRequest(remoteServerUrl, req, res);
    }
  );

  // Start the server
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`Proxy Server is listening on port ${PORT}`);
  });
}

main();

///////////////////////////////////////////


async function handleRequest(remoteUrlString: string, req: IncomingMessage, res: ServerResponse) {
  // Parse the URL of the remote server
  const remoteUrl = new URL(remoteUrlString);

  console.log(`${req.url}`);

  // This emulates an endpoint provided by OpenAI to list the models. We retrieve the deployed models from AI Core and map them to the OpenAI model format
  if (req.url === "/models") {
    returnOpenAIModels(res);
    return;
  }

  // Wait until the payload is fully received
  let payload = await requestPayload(req);

  const payloadObject = JSON.parse(payload);

  logRequestToFile("in", req.url || "", req.headers, payloadObject);

  // Initialize the new path on AI Core to which we will forward the request
  let newPath = "";

  const modelInPayload: string = payloadObject?.model ?? "";


  try {

    // This is how Azure deployed models are typically called. We just need to adjust the path a bit for forwarding it to AICore
    // Assumes that deploymentId in Azure SDK is the same as the deploymentId in AI Core
    if (req.url?.includes("/openai/")) {
      newPath = req.url
        ?.replace("//", "/")
        .replace("/openai/", "/v2/inference/");
    }

    else if (modelInPayload.includes("anthropic")) {
      const deploymentPath = findDeploymentByModel(modelInPayload);
      delete payloadObject.model
      // delete payloadObject.stream
      // payloadObject["anthropic_version"] = "bedrock-2023-05-31"
      // payloadObject.max_tokens = 4096
      newPath = `${deploymentPath}/invoke`
    }

    else {

      const deploymentPath = findDeploymentByModel(modelInPayload);

      delete payloadObject.model;

      newPath =
        deploymentPath +
        req.url?.replace("//", "/") +
        "?api-version=2024-06-01";
    }
  } catch (e: any) {
    console.error(`Error processing request: ${e.message}`);
    res.writeHead(500);
    res.end("Internal Server Error");
    return;
  }

  delete req.headers.host;
  delete req.headers["api-key"];
  delete req.headers.authorization;

  req.headers["authorization"] = `Bearer ${token}`;
  req.headers["AI-Resource-Group"] = `default`;

  forwardRequest(remoteUrl, newPath, req, res, payloadObject);
};

function logRequestToFile(inOut: "in" | "out", path: string, headers: any, payloadObject: any) {

  if (!WRITE_REQUESTS_TO_FILE) { return }

  const epoch = new Date().getTime();

  // create requests directory if it does not exist
  if (!fs.existsSync('./requests')) {
    fs.mkdirSync('./requests');
  }

  // create a file with the payload use epoch as filename
  const filename = `./requests/${epoch}-${inOut}.json`;
  fs.writeFileSync(filename, JSON.stringify({ path, headers, payload: payloadObject }, null, 2));

}

async function forwardRequest(remoteUrl: URL, path: string, req: http.IncomingMessage, res: http.ServerResponse<http.IncomingMessage>, payloadObject: any) {

  const options: http.RequestOptions = {
    hostname: remoteUrl.hostname,
    port: remoteUrl.port || (remoteUrl.protocol === "https:" ? 443 : 80),
    path: path,
    method: req.method,
    headers: req.headers,
  };

  options.headers = req.headers;

  delete options.headers["content-length"];

  console.log(`Sent to : ${options.hostname}${options.path}`);

  // Choose either HTTP or HTTPS based on the protocol
  const protocol = remoteUrl.protocol === "https:" ? https : http;

  // Forward the request to the remote server

  let retryCount = 0

  while (retryCount >= 0 && retryCount < 5) {

    try {
      const proxyReq =
        await makeProxyRequest(protocol, options, res, payloadObject);
      logRequestToFile("out", path, options.headers, payloadObject);
      retryCount = -1
    }
    catch (e) {
      console.error(`Error forwarding request: ${e}. RETRYING...`);
      retryCount++
    }

    //wait 3 seconds before retry
    if (retryCount >= 0) {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

async function makeProxyRequest(protocol: typeof http | typeof https, options: http.RequestOptions, res: http.ServerResponse<http.IncomingMessage>, payloadObject: any) {
  return new Promise((resolve, reject) => {

    const proxyReq = protocol.request(options, (proxyRes) => {

      if (proxyRes.statusCode === 429) {
        reject(new Error("Rate limit exceeded"));
        return
      }
      else { resolve(proxyReq) }

      // Set the response headers and status code from the remote server
      res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);

      // Get response, log it, and write to res
      let body = "";
      proxyRes.on("data", (chunk) => {
        body += chunk;
        console.log(`Chunk: ${chunk}`);
        res.write(chunk);
      });

      proxyRes.on("end", () => {
        console.log(`Response: ${body}`);
        res.end(body);
      });

    });

    // Handle errors in the forwarding process
    proxyReq.on("error", (e) => {
      console.error(`Error forwarding request: ${e.message}`);
      res.writeHead(500);
      res.end("Internal Server Error");
    });

    const payloadStringified = JSON.stringify(payloadObject)

    // send the payload to the remote server
    proxyReq.write(payloadStringified);

    proxyReq.end();
  }

  );
}

function findDeploymentByModel(model: string): string {
  const deployment = deployments.resources?.find(
    (deployment) => deployment.details.resources.backend_details.model.name === model &&
      deployment.status === "RUNNING"
  );

  if (!deployment) {
    throw new Error(`Model ${model} not found or not running`);
  }

  const deploymentId = deployment?.id;

  console.log(`Requested Model: ${model} ==> Deployment ID: ${deploymentId}`);

  const deploymentPath = `/v2/inference/deployments/${deploymentId}`

  return deploymentPath;
}

// Read the complete payload from the request
function requestPayload(req: http.IncomingMessage): Promise<any> {
  return new Promise<any>((resolve, reject) => {
    let payload = "";
    req.on("data", (chunk) => {
      payload += chunk;
    });

    req.on("end", () => {
      resolve(payload);
    });

    req.on("error", (err) => {
      console.error(`Error reading payload: ${err.message}`);
      reject(err);
    }) as any;
  });
}

async function getAICoreDeployments(
  apiUrl: string,
  token: string,
  resourceGroup: string = "default"
) {
  const apiResult = await axios.get(`${apiUrl}/v2/lm/deployments`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "AI-Resource-Group": resourceGroup,
    },
  });

  const deployments = apiResult.data as Deployments;

  // Just log the model names in a string, separated by commas
  deployments &&
    deployments.resources &&
    console.log(
      `Deployed models: ${deployments.resources
        .map(
          (deployment) =>
            deployment.details.resources.backend_details.model.name
        )
        .join(", ")}`
    );

  return deployments;
}

// Respond to the models endpoint with the list of models deployed in AI Core
function returnOpenAIModels(res: http.ServerResponse<http.IncomingMessage>) {

  // TODO: Filter deployments for OpenAI models using the AI Core executable attribute
  res.writeHead(200, {
    "Content-Type": "application/json",
  });

  if (!deployments || !deployments.resources) {
    res.end(JSON.stringify({ object: "list", data: [] }));
    return;
  }

  // Build list of models from deployments, use only in state RUNNING and map model like in the OpenAI API
  const models = {
    object: "list",
    data: deployments.resources.map((deployment) => {
      return {
        id: deployment.details.resources.backend_details.model.name,
        object: "model",
        created: new Date(deployment.createdAt).getTime(),
        owned_by: "openai",
      };
    }),
  };

  res.end(JSON.stringify(models));
}

async function fetchTokenWithClientSecret({
  url,
  clientid,
  clientsecret,
}: {
  url: string;
  clientid: string;
  clientsecret: string;
}): Promise<string> {
  let res: AxiosResponse;
  let token: string | undefined;

  const headers = {
    "content-type": "application/x-www-form-urlencoded;charset=utf-8",
  };

  const httpCall = {
    url: url.includes("/oauth/token") ? url : `${url}/oauth/token`,
    method: "post",
    auth: { username: clientid, password: clientsecret },
    data: "grant_type=client_credentials&response_type=token",
    headers: headers,
  };

  res = await axios(httpCall);

  const json = res.data;
  token = json.access_token as string;
  return token;
}

type Deployments = {
  count?: number;
  resources?: Deployment[];
};

type Deployment = {
  configurationId: string;
  configurationName: string;
  createdAt: string;
  deploymentUrl: string;
  details: Details;
  id: string;
  lastOperation: string;
  latestRunningConfigurationId: string;
  modifiedAt: string;
  scenarioId: string;
  startTime: string;
  status: string;
  submissionTime: string;
  targetStatus: string;
};

type Details = {
  resources: Resources;
  scaling: Scaling;
};

type Resources = {
  backend_details: BackendDetails;
};

type BackendDetails = {
  model: Model;
};

type Model = {
  name: string;
  version: string;
};

type Scaling = {
  backend_details: {};
};
type Creds = {
  serviceurls: {
    AI_API_URL: string;
  };
  appname?: string;
  clientid: string;
  clientsecret: string;
  identityzone?: string;
  identityzoneid?: string;
  url: string;
};
