const bodyParser = require("body-parser")

const main = (req, res) => {
    console.log(JSON.stringify(req.body));

    res.send("Done.")
}

exports.wrapper = (req, res) => {
  bodyParser.urlencoded({extended: false})(req, res, () => main(req, res));
};