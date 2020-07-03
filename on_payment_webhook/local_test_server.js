const express = require('express')
const {wrapper} = require("./cloud_function")
const app = express();
const port = 80;

app.post("/", wrapper);

app.listen(port, () => console.log(`Cloud function listening on http://localhost:80`))