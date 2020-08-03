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

1. Clone this repository.

2. Set the variable `isDevelopment` in `index.html` to `true`.

3. Open `index.html` in your browser. Note that there will be no styling as explained above.

4. Fill out the form and complete a PayPal purchase using a [Personal PayPal Sandbox Account](https://developer.paypal.com/docs/api-basics/sandbox/accounts/).

5. For the form submission to submit properly, you need to also be [running `membership-form-backend` locally](../membership-form-backend/README.md).

### Running on squarespace (as a test)

1. Make sure the variable `isDevelopment` in `index.html` is still `true`.

2. Copy paste the content of `index.html` into a hidden webpage on Squarespace using the "Code" component on squarespace.

3. Test it (see below)!

### Testing the form

While completing the form, check the following:

- [ ] Form styling renders and is aesthetically pleasing (only when testing on Squarespace).
- [ ] Form will not allow submission without the required fields or with an invalid email.
- [ ] Spinner displays while the form submits.

Right before paying, open the network tab in your browser developer tools.
Complete the payment and then check the following in the POST request to the backend.

- [ ] Request is being sent to correct URL (not localhost)
- [ ] Request form data contains every field and the data you inputted.

### Deploying the form on squarespace

1. :warning: Set the variable `isDevelopment` in `index.html` to `false`.

2. Copy paste the content of index.html into the existing code block on the Squarespace membership sign up form page.

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