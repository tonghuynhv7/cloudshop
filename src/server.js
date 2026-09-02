const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const products = [
  { id: 1, name: "Laptop", price: 20000000 },
  { id: 2, name: "Keyboard", price: 1500000 },
  { id: 3, name: "Mouse", price: 800000 }
];

app.get("/", (req, res) => {
  res.json({
    service: "CloudShop API",
    status: "running"
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy"
  });
});

app.get("/api/ready", (req, res) => {
  res.json({
    status: "ready"
  });
});

app.get("/products", (req, res) => {
  res.json(products);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`CloudShop API running on port ${PORT}`);
});