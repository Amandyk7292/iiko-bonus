const failure = (code, statusCode = 502) => Object.assign(new Error(code), { code, statusCode });

module.exports = { failure };
