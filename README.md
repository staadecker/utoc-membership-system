# UTOC Membership System

This repository contains the different components used in the University of Toronto Outing Club's (UTOC's) membership system.

## System Context

UTOC needs a way to track members, have an up-to-date member mailing list and accept membership payments online.
This system aims to meet those needs.

## System description

This system tracks UTOC's members in a Google Sheets database.
The database is synchronized with a Google Groups mailing list.
Finally, a membership sign up form is added to UTOC's website.
The sign up form asks for membership info (name, email, etc.) as well as payment through PayPal.
When the payment is complete, the member is added to the Google Sheets database.

## Software Components

This section presents the 4 different components of the system. Visit each component's README for component-specific details.

### [`membership-form-frontend`](./components/membership-form-frontend)

The first component is a membership sign up form.
This form is embedded on our squarespace website and collects both membership information as well as a payment through PayPal buttons.
This component is simply some HTML + Javascript that is hosted on Firebase Hosting.

### [`membership-form-backend-trigger`](./components/membership-form-backend-trigger)

The second component is what receives requests from the membership sign up form.
It will read the request, send it on to `membership-form-backend` and then redirect the user to our welcome page.
It is hosted as a Google Cloud Function.

### [`membership-form-backend`](./components/membership-form-backend)

The third component receives the membership sign up request via `membership-form-backend-trigger`.
The function verifies that the PayPal transaction is valid, adds the member to our Google Sheets database & Google Group and sends the member a welcome email.
It is hosted as a Google Cloud Function.

### [`expired-members-remover`](./components/expired-members-remover)

The fourth component, is a script that removes expired members from the mailing system
and sends members an email notifying them of their membership expiry. 
It is hosted as a Google Cloud Function that is triggered daily by the Google Cloud Scheduler.

## Next steps

If you want to learn more about the system, how it works, how to run it locally, and how to test it, then read the following docs.

- [Adding a Member Manually](./docs/Adding%20a%20Member%20Manually.md)

- [Docs for developers](./docs/For%20Developers.md)

- README's for each component (links in headers above)

## Contact Info

The code was developed by Martin Staadecker, webmaster for UTOC from 2020 to 2022.
I'm reachable at [machstg@gmail.com](mailto:machstg@gmail.com) and happy to answer any questions.
