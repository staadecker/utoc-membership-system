# `membership-form-frontend`

This component contains a membership sign up form. This form is embedded on our squarespace website for members to complete the registration process.

## Description

The form has two parts. The first collects membership information (e.g. name, email, school, etc).
The second displays PayPal payment buttons.
Once the user inputs their membership information and completes the Paypal payment, the form is submitted to the backend
(see [`membership-form-backend`](../membership-form-backend)).

## Technical details

This form is some simple HTML, CSS and Javascript. It has been purposefully kept simple.

The form is hosted on Google Firebase and then embedded on the squarespace website using on iframe.

The form can submit to three different endpoints depending on the environment (localhost, testing GCP project, production GCP project).
During the build process, the appropriate environment is selected. When testing locally, one must create the proper `env.js` file (see below).

## Development

In this section, I discuss the different steps involved in developing to the form.

### Running locally

Here are the steps to run the form on your computer.

1. Clone this repository.

2. Copy `./environment/env.localhost.js` to `./env.js`. This will specify to use the PayPal sandbox environment and localhost endpoint.

3. Open `index.html` in your browser.

4. Fill out the form and complete a PayPal purchase using a [Personal PayPal Sandbox Account](https://developer.paypal.com/docs/api-basics/sandbox/accounts/).

5. For the form submission to submit properly, you need to also be [running `membership-form-backend` locally](../membership-form-backend/README.md).

### Running on squarespace (as a test)

TODO

### Testing the form

While completing the form, check the following:

- [ ] All form questions render and are aesthetically pleasing.
- [ ] No spelling mistakes.
- [ ] Can't submit without the required fields.
- [ ] Can submit without the optional fields.
- [ ] PayPal payment window reflects the selected amount.

Right before paying, open the network tab in your browser developer tools.
Complete the payment and then check the following in the POST request to the backend.

- [ ] Request is being sent to correct URL
- [ ] Request data contains every field with the data you inputted.

### Deploying the form on squarespace

Changes will be automatically deployed by Google Cloud Build upon merging the changes to the remote master branch.