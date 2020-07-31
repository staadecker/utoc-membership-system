# UTOC Membership System

This repository contains the different components used in the University of Toronto Outing Club's (UTOC's) membership system.

## Components

This section presents the 3 different components of the system. Visit each component's README for component-specific details.

### `membership-form-frontend`

The first component is a membership sign up form.
This form is embedded on our squarespace website and collects both membership information as well as a payment through PayPal buttons.

### `membership-form-backend`

The second component is a Google Cloud function that receives the frontend form submission.
The function verifies that the PayPal transaction is valid and adds the member to our Google Sheets database.
We use Google Sheets to allow non-technical UTOC executives to manually add members if necessary (e.g. member pays in cash).

### `mailing-list-synchronizer`

The third component, is a cloud function that runs daily.
This function syncs a Google Group (which we use as a mailing list) with the Google Sheets database.
Expired memberships are removed from the Google Group while new memberships are added.
An email notification is sent to members whenever there's a change.

# Next steps

If you want to learn more about the system, how it works, how to run it locally, and how to test it, then read the following docs.PayPal

- [System Architecture](./docs/System%20Architecture.md)

- [Developer Setup](./docs/Developer%20Setup.md)

- [Testing the system](./docs/Testing.md)

- README's for each components (links in headers above)

## Contact Info

The code was developed by Martin Staadecker, webmaster for UTOC in 2020-21.
I'm reachable at [machstg@gmail.com](mailto:machstg@gmail.com) and happy to answer any questions.