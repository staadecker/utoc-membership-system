# UTOC Membership System

While serving as Webmaster for the University of Toronto Outing Club (UTOC), I built this system to track and manage the club's members. As of Winter 2024, the system is still in use and allows UTOC to contact members via a mailing list, accept membership payments online, and automatically remind people to renew their memberships upon expiry.

The entire system is open source, available in this repository, and runs completely free since it does not exceed UTOC's Google Cloud Platform's free quotas.

## System summary

This system tracks UTOC members in an private Google Sheets database where UTOC execs can view past and present members.
The database is synchronized with a Google Groups mailing list used to contact members.
A membership sign up form embedded on the UTOC website collects membership information (name, email, etc.) and processes PayPal payments before adding members to the Google Sheets database. The database is scanned daily to check for expired memberships. When expired memberships are found the member is sent an notification email and removed from the mailing list. 

## How it works

This section presents the 4 different components of the system. Visit each component's README for component-specific details. Each component is hosted on UTOC's Google Cloud Platform account.

### [`membership-form-frontend`](./components/membership-form-frontend)

This component is a membership sign up form that is embedded in UTOC's squarespace website and collects both membership information as well as a payment through [PayPal buttons](https://developer.paypal.com/docs/checkout/standard/).
This component is simply some static HTML and Javascript code that is hosted via UTOC's [Firebase Hosting](https://firebase.google.com/docs/hosting) and embedded via an `iframe`.
Submitting the form sends an HTTPS request to the `membership-form-backend-trigger` (see below).

### [`membership-form-backend-trigger`](./components/membership-form-backend-trigger)

This component is what receives sign up requests from the membership sign up form.
It reads the request, forwards it to `membership-form-backend` for processing and redirects the member to UTOC's new member welcome page.
It is hosted as a Python [Google Cloud Function](https://cloud.google.com/functions).
The processing of the sign up request is done in a seperate component to allow the user to be redirected nearly instantaneously to the welcome page
rather than making them to wait for the sign up to be processed.

### [`membership-form-backend`](./components/membership-form-backend)

This component receives the membership sign up request from the `membership-form-backend-trigger` and processes it.
The Python processing script verifies that the PayPal transaction is valid, adds the member to UTOC's Google Sheets database & Google Group and sends the member a welcome email.
Again, it is hosted as a Python Google Cloud Function.

### [`expired-members-remover`](./components/expired-members-remover)

This component is a Python script that runs daily to removes expired members from the mailing system.
It also sends members an email notifying them of their membership expiry. 
It is hosted as a Google Cloud Function that is triggered daily by the Google Cloud Scheduler.

## Security, automatic deployments and reliability

No payment information (credit card numbers, etc.) is ever transferred to a UTOC server. PayPal buttons are built such that the payment is handled directly PayPal. The UTOC servers simply check with PayPal that the payment was received before adding the member to the system.

Secrets for the various APIs are stored securely in Google Cloud's Secret Manager. Dedicated service accounts that follow the least privilege principle are used for operations. Dev, staging and production environments are completely isolated.

The use of Github's [dependabot](https://docs.github.com/en/code-security/dependabot) and automatic deployments from Github via Google Cloud Build allows for easy patches when vulnerabilities are discovered in the underlying Javascript libraries.

Should an error occur in one of the Python scripts, Martin Staadecker would get notified by email via Google Cloud Error Reporting. Since fixing a few minor bugs that were discovered during the first year of operations, there has been no known errors in the system.

## Limitations

Updating the membership pricing or membership types requires a minor code update on both the front and backend. Although trivial for an experienced developer, this can be challenging for a non-technical UTOC exec.

## Next steps

If you want to learn more about the system, how it works, how to run it locally, and how to test it, then read the following docs.

- [Adding a Member Manually](./docs/Adding%20a%20Member%20Manually.md)

- [Docs for developers](./docs/For%20Developers.md)

- README's for each component (links in headers above)

## Contact Info

The code was developed by Martin Staadecker, webmaster for UTOC from 2020 to 2022.
I'm reachable at [machstg@gmail.com](mailto:machstg@gmail.com) and happy to answer any questions.
