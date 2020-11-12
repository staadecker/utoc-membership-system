const TOPIC_NAME = "membership-form-backend";
const WELCOME_URL = "https://utoc.ca/welcome";

const { PubSub } = require("@google-cloud/pubsub");
const pubSubClient = new PubSub();

module.exports.main = async (req, res) => {
  try {
    console.log("Received request.");

    console.log("Publishing request body to Pub/Sub...");
    await pubSubClient
      .topic(TOPIC_NAME)
      .publish(Buffer.from(JSON.stringify(req.body), "utf8"));

    console.log("Redirecting to welcome page...");
    // We don't use res.redirect since that would redirect only the iFrame not the entire page
    res.send(
      `<script>window.top.location.href = \"${WELCOME_URL}\"; </script>`
    );

    console.log("Done.");
  } catch (e) {
    console.error(e);
    console.log(`Recovering request body: ${JSON.stringify(req.body)}`); // Ensures we don't loose any data.
    res
      .status(500)
      .send("An unexpected error occurred, please contact webmaster@utoc.ca");
  }
};
