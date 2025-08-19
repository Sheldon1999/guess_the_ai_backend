import http from "http";
const base = process.env.BASE || "http://localhost:3000";
const users = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333",
  "0x4444444444444444444444444444444444444444",
  "0x5555555555555555555555555555555555555555"
];
const rounds = 40;

function post(path, payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = http.request(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } }, res => {
      let body = ""; res.setEncoding("utf8");
      res.on("data", d => body += d);
      res.on("end", () => resolve({ status: res.statusCode, data: body }));
    });
    req.on("error", reject);
    req.write(data); req.end();
  });
}

(async () => {
  const seen = Object.fromEntries(users.map(u => [u, new Set()]));
  let ok = 0, repeats = 0, noEligible = 0;

  for (let r = 0; r < rounds; r++) {
    await Promise.all(users.map(async u => {
      const { status, data } = await post("/game/next", { walletAddress: u });
      if (status === 204) { noEligible++; return; }
      if (status !== 200) { console.log("err", status, data); return; }
      const j = JSON.parse(data);
      const key = j.imageId || j.hash;
      if (seen[u].has(key)) repeats++; else { seen[u].add(key); ok++; }
    }));
  }
  console.log({ ok, repeats, noEligible, perUser: Object.fromEntries(users.map(u => [u, seen[u].size])) });
})();
