# For developers

## Get set up

1. [Install NodeJS 10](https://nodejs.org/en/download/).

2. Install the [Google Cloud SDK](https://cloud.google.com/sdk/docs).

3. Clone this repository.

4. In the cloned repository, run `yarn` or `yarn install` in the root directory to install all the packages.

5. Run `yarn auth` and login with your `@utoc.ca` account.
   This will allow you to access the staging environment.
   You will need to run this command every 8 hours to re-authenticate.
   
## Different environments

There are 3 environments that you'll deal with.

1. Local environment (referred to as dev). This runs on your computer only.

2. Test environment. This is deployed to the internet the same way as the production environment, 
   obviously using a test database and mailing list. The only difference is it uses a Developer PayPal 
   account, so you don't actually need to pay money to test the system.
   
3. Production environment. This is what the public sees.

## Running the dev environment

Follow the instructions under [`components/membership-form-frontend/README.md`](components/membership-form-frontend/README.md).

## Deploying

The code is deployed to production every time a new tag is released on the master branch
on GitHub. The deployment pipeline can be managed through Google Cloud Build.

## More questions ?

If the documentation here is insufficient, contact me and I'll be happy to walk you through
any parts of the system. Contact information at the bottom of the main README.