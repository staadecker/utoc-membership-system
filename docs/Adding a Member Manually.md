# Adding a Member Manually

Sometimes a member wants to pay via cash or e-transfer in which case they
need to be added manually to the system. For this you can make a
custom HTTPS request to the `membership-form-backend-trigger` script
using a password. Here's how.

## Steps

1. Retrieve the `manual_sign_up_password` from Google Secret Manager.

2. Download [Postman](https://www.postman.com/downloads/) or use the web version.

3. Create a new API request of type POST with one of the following URLs.
    - For testing: `https://northamerica-northeast1-utoc-membership-system-test.cloudfunctions.net/membership-form-backend-trigger`
    - For production: `https://northamerica-northeast1-utoc-membership-system.cloudfunctions.net/membership-form-backend-trigger`

4. Add the following key-pairs in the Body section (select raw -> JSON).

```
{
    "first_name": "Adam",
    "last_name": "Ondra",
    "school": "U of T",
    "program_and_college": "EngSci",
    "email": "test@utoc.ca",
    "membership_type": "student",
    "manual_sign_up_password": "Password from GCP Secret Manager",
    "comments": "Some comment"
}
```

5. Submit the request