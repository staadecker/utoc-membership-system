# membership-form-backend-trigger

This component is a [Google Cloud Function](https://cloud.google.com/functions/docs/concepts/overview) that listens for requests from the frontend form (`membership-form-frontend`).
When it receives a request (containing the member's data and PayPal Order) it publishes an event on [Pub/Sub](https://cloud.google.com/pubsub/docs/overview)
(Google Cloud Platform's internal messaging system) and redirects the user to the welcome page.
The Pub/Sub event will trigger the `membership-form-backend` function.

## Motivation

This function acts as a middleman. Ideally we could remove it and have the frontend immediately trigger the
`membership-form-backend` function. However, cloud functions terminate when a response is sent to the user.
Therefore, a response can only be sent after the cloud function completes all operations.
If we weren't to use this middleware, the user would have to face a loading screen for many seconds before receiving the redirect to welcome page response.
This is why we use the middleware which makes use of the asynchronous Pub/Sub system.

## Testing

There isn't much to test in such a simple function, however one can deploy it to the test project and verify that
it forwards all the frontend request data. Use `yarn workspace membership-form-backend-trigger deploy` to deploy
the function to the test project.

## Deploying

To deploy to production use `yarn workspace membership-form-backend-trigger deploy-prod`.

## Other notes

- The cloud function must be invokable by all unauthenticated users (to be able to be invoked from the frontend).

- The cloud function service account must have publishing permissions to the Pub/Sub topic.

- The Pub/Sub topic name is hard-coded to `membership-form-backend`.

- Any errors in the function will display a generic: "An unexpected error occurred, please contact us".
Errors will also log the request of the body to not loose any data.