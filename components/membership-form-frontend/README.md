# `membership-form-frontend`

This component contains a membership sign up form. This form is embedded on our squarespace website for members to complete the registration process.

## Description

The form has two parts. The first collects membership information (e.g. name, email, school, etc).
The second displays PayPal payment buttons.
Once the user inputs their membership information and completes the Paypal payment, the form is submitted to the backend
(see [`membership-form-backend`](../membership-form-backend)).

## Technical details

This form is simply HTML code with some embedded Vanilla Javascript.
It is kept simple to allow for easy embedding on the squarespace website.

For styling, we give our HTML tags classes that match Squarespace's form styling classes.
Note that since we inherit the styling from Squarespace, serving the HTML page locally will render a page with no styling.

## Development

In this section, I discuss the different steps involved in developing to the form.

### Running locally

Here are the steps to run the form on your computer.

1. Set the variable `isDevelopment` in `index.html` to `true`.

2. Open `index.html` in your browser. Note that there will be no styling as explained above.

3. Fill out the form and complete a PayPal purchase using a [Personal PayPal Sandbox Account](https://developer.paypal.com/docs/api-basics/sandbox/accounts/).

4. For the form submission to submit properly, you need to also be [running `membership-form-backend` locally](../membership-form-backend/README.md).

### Testing

1. Open your browser's developer panel and navigate to the Network tab.membership

2. Complete the form and payment as explained above.

3. Inspect the request in the network tab to ensure all the data is properly formatted.

### Deploying the form

1. Set the variable `isDevelopment` in `index.html` to `false`.

2. Copy paste the content of `index.html` into the Squarespace code block. Only copy the code within the `<body>` tag (not including the tag itself).

3. Test it! (see [the testing docs](/docs/Testing.md))

## Design considerations

In this section, I discuss two design decisions that I made while building the membership form.

### Inheriting styling from squarespace

The decision to inherit styling from squarespace got rid of the need for custom CSS but comes with some drawbacks.
Notably, changes to squarespace's internal system (e.g. CSS class names) could break the styling of the form.
Given the time, I would write my own CSS to style the form independently from squarespace.

### Embedded form vs hosted site

The decision to embedded the form on the squarespace website rather than hosting it separately has advantages and disadvantages.
Embedding gets rid of the extra complexity of hosting a site.
That being said, hosting a site would offer more flexibility and would offer the possibility of using better tools such as React.
Overall, considering the membership form to be small and simple, I decided to keep the system as minimal as possible, opting for the embedded form.