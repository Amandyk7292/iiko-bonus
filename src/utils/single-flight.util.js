class SingleFlight {
  constructor() {
    this.requests = new Map();
  }

  run(key, factory) {
    if (this.requests.has(key)) return this.requests.get(key);
    const request = Promise.resolve().then(factory);
    this.requests.set(key, request);
    return request.finally(() => {
      if (this.requests.get(key) === request) this.requests.delete(key);
    });
  }

  get size() {
    return this.requests.size;
  }
}

module.exports = { SingleFlight };
