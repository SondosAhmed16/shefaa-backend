const { validationResult } = require("express-validator");

const runValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      errors: errors.array().map((e) => ({ param: e.param, msg: e.msg })),
    });
  }
  next();
};

module.exports = { runValidation };
