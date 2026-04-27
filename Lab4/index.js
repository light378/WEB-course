const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.json());

const ALLOWED_MODES = ["charging", "discharging", "idle"];

let eventSeq = 1;

let bessSystems = [
  {
    id: 1,
    name: "BESS-1 (Левада)",
    capacity: 5000,
    power: 1000,
    stateOfCharge: 65,
    chargingPower: 300,
    dischargingPower: 200,
    cycleCount: 125,
    temperature: 28,
    mode: "charging",
    lastUpdated: "2026-04-27T10:00:00.000Z",
    readingsHistory: [
      {
        eventId: eventSeq++,
        timestamp: "2026-04-27T10:00:00.000Z",
        stateOfCharge: 65,
        chargingPower: 300,
        dischargingPower: 200,
        temperature: 28,
        mode: "charging"
      }
    ]
  },
  {
    id: 2,
    name: "BESS-2 (Дніпро)",
    capacity: 10000,
    power: 2000,
    stateOfCharge: 42,
    chargingPower: 0,
    dischargingPower: 850,
    cycleCount: 78,
    temperature: 32,
    mode: "discharging",
    lastUpdated: "2026-04-27T09:30:00.000Z",
    readingsHistory: [
      {
        eventId: eventSeq++,
        timestamp: "2026-04-27T09:30:00.000Z",
        stateOfCharge: 42,
        chargingPower: 0,
        dischargingPower: 850,
        temperature: 32,
        mode: "discharging"
      }
    ]
  },
  {
    id: 3,
    name: "BESS-3 (Харків)",
    capacity: 2000,
    power: 500,
    stateOfCharge: 98,
    chargingPower: 0,
    dischargingPower: 0,
    cycleCount: 310,
    temperature: 25,
    mode: "idle",
    lastUpdated: "2026-04-26T22:15:00.000Z",
    readingsHistory: []
  }
];

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

function findBess(id) {
  return bessSystems.find((b) => b.id === id);
}

function toPublicBess(bess) {
  const { readingsHistory, ...rest } = bess;
  return rest;
}

function validateUpdate(body) {
  const errors = [];
  const allowed = ["name", "capacity", "power", "cycleCount", "temperature"];
  const keys = Object.keys(body);

  if (keys.length === 0) {
    errors.push("Request body is empty.");
    return errors;
  }

  for (const key of keys) {
    if (!allowed.includes(key)) {
      errors.push(`Field '${key}' is not allowed for update.`);
    }
  }

  if ("name" in body && (typeof body.name !== "string" || body.name.trim() === "")) {
    errors.push("name must be a non-empty string.");
  }

  if ("capacity" in body && (typeof body.capacity !== "number" || body.capacity <= 0)) {
    errors.push("capacity must be a number > 0 (kWh).");
  }

  if ("power" in body && (typeof body.power !== "number" || body.power <= 0)) {
    errors.push("power must be a number > 0 (kW).");
  }

  if ("cycleCount" in body && (typeof body.cycleCount !== "number" || body.cycleCount < 0)) {
    errors.push("cycleCount must be a number >= 0.");
  }

  if ("temperature" in body && (typeof body.temperature !== "number" || body.temperature < -20 || body.temperature > 80)) {
    errors.push("temperature must be a number between -20 and 80 °C.");
  }

  return errors;
}

function validateReadings(body) {
  const errors = [];
  const allowedFields = ["stateOfCharge", "chargingPower", "dischargingPower", "temperature", "mode"];
  const keys = Object.keys(body);
  for (const key of keys) {
    if (!allowedFields.includes(key)) {
      errors.push(`Field '${key}' is not allowed in readings.`);
    }
  }

  if ("stateOfCharge" in body && (typeof body.stateOfCharge !== "number" || body.stateOfCharge < 0 || body.stateOfCharge > 100)) {
    errors.push("stateOfCharge must be a number between 0 and 100.");
  }
  if ("chargingPower" in body && (typeof body.chargingPower !== "number" || body.chargingPower < 0)) {
    errors.push("chargingPower must be a number >= 0 (kW).");
  }
  if ("dischargingPower" in body && (typeof body.dischargingPower !== "number" || body.dischargingPower < 0)) {
    errors.push("dischargingPower must be a number >= 0 (kW).");
  }
  if ("temperature" in body && (typeof body.temperature !== "number" || body.temperature < -20 || body.temperature > 80)) {
    errors.push("temperature must be a number between -20 and 80 °C.");
  }
  if ("mode" in body && (typeof body.mode !== "string" || !ALLOWED_MODES.includes(body.mode))) {
    errors.push(`mode must be one of: ${ALLOWED_MODES.join(", ")}.`);
  }
  return errors;
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/api/bess", (req, res) => {
  let result = bessSystems.map(toPublicBess);
  if (req.query.mode) {
    const modeFilter = req.query.mode;
    if (ALLOWED_MODES.includes(modeFilter)) {
      result = result.filter(b => b.mode === modeFilter);
    } else {
      return res.status(400).json({ error: "Invalid mode filter. Use charging/discharging/idle." });
    }
  }
  if (req.query.minCapacity) {
    const minCap = Number(req.query.minCapacity);
    if (!isNaN(minCap) && minCap >= 0) {
      result = result.filter(b => b.capacity >= minCap);
    } else {
      return res.status(400).json({ error: "minCapacity must be a positive number." });
    }
  }
  res.json(result);
});

app.get("/api/bess/:id", (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id." });

  const bess = findBess(id);
  if (!bess) return res.status(404).json({ error: "BESS system not found." });

  res.json(toPublicBess(bess));
});

app.get("/api/bess/:id/history", (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id." });

  const bess = findBess(id);
  if (!bess) return res.status(404).json({ error: "BESS system not found." });

  res.json({
    id: bess.id,
    name: bess.name,
    history: bess.readingsHistory || []
  });
});

app.post("/api/bess/:id/readings", (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id." });

  const bess = findBess(id);
  if (!bess) return res.status(404).json({ error: "BESS system not found." });

  const errors = validateReadings(req.body || {});
  if (errors.length > 0) return res.status(400).json({ errors });

  const now = new Date().toISOString();
  const newReading = {
    eventId: eventSeq++,
    timestamp: now,
    stateOfCharge: bess.stateOfCharge,
    chargingPower: bess.chargingPower,
    dischargingPower: bess.dischargingPower,
    temperature: bess.temperature,
    mode: bess.mode
  };

  if (req.body.stateOfCharge !== undefined) bess.stateOfCharge = req.body.stateOfCharge;
  if (req.body.chargingPower !== undefined) bess.chargingPower = req.body.chargingPower;
  if (req.body.dischargingPower !== undefined) bess.dischargingPower = req.body.dischargingPower;
  if (req.body.temperature !== undefined) bess.temperature = req.body.temperature;
  if (req.body.mode !== undefined) bess.mode = req.body.mode;

  bess.lastUpdated = now;

  const recordedReading = {
    eventId: eventSeq++,
    timestamp: now,
    stateOfCharge: bess.stateOfCharge,
    chargingPower: bess.chargingPower,
    dischargingPower: bess.dischargingPower,
    temperature: bess.temperature,
    mode: bess.mode
  };
  bess.readingsHistory.push(recordedReading);

  res.json({
    message: "Readings recorded successfully.",
    bess: toPublicBess(bess),
    reading: recordedReading
  });
});

app.put("/api/bess/:id", (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id." });

  const bess = findBess(id);
  if (!bess) return res.status(404).json({ error: "BESS system not found." });

  const errors = validateUpdate(req.body || {});
  if (errors.length > 0) return res.status(400).json({ errors });

  if ("name" in req.body) bess.name = req.body.name.trim();
  if ("capacity" in req.body) bess.capacity = req.body.capacity;
  if ("power" in req.body) bess.power = req.body.power;
  if ("cycleCount" in req.body) bess.cycleCount = req.body.cycleCount;
  if ("temperature" in req.body) bess.temperature = req.body.temperature;

  res.json({
    message: "BESS system updated.",
    bess: toPublicBess(bess)
  });
});

app.delete("/api/bess/:id", (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid id." });

  const index = bessSystems.findIndex((b) => b.id === id);
  if (index === -1) return res.status(404).json({ error: "BESS system not found." });

  const [deleted] = bessSystems.splice(index, 1);
  res.json({
    message: "BESS system deleted.",
    bess: toPublicBess(deleted)
  });
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "Endpoint not found." });
});

app.use((req, res) => {
  res.status(404).send("Page not found.");
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON body." });
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`Server started: http://localhost:${PORT}`);
});