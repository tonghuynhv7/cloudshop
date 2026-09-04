import { useEffect, useState } from "react";
import "./App.css";

function App() {
  const [products, setProducts] = useState([]);
  const [status, setStatus] = useState("checking");

  const API_URL = import.meta.env.VITE_API_URL;

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((res) => {
        if (!res.ok) {
          throw new Error("Health check failed");
        }
        return res.json();
      })
      .then((data) => {
        setStatus(data.status);
      })
      .catch((err) => {
        console.error("API health check failed:", err);
        setStatus("offline");
      });

    fetch(`${API_URL}/products`)
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to load products");
        }
        return res.json();
      })
      .then((data) => {
        setProducts(data);
      })
      .catch((err) => {
        console.error("Failed to load products:", err);
      });
  }, [API_URL]);

  const getProductIcon = (name) => {
    const productName = name.toLowerCase();

    if (productName.includes("laptop")) return "💻";
    if (productName.includes("keyboard")) return "⌨️";
    if (productName.includes("mouse")) return "🖱️";

    return "📦";
  };

  return (
    <div className="app">
      <header className="navbar">
        <a href="#home" className="brand">
          <div className="logo">C</div>
          <span>CloudShop</span>
        </a>

        <nav className="nav-links">
          <a href="#products">Products</a>

          <a
            href="https://github.com/tonghuynhv7/cloudshop"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>

          <a
            href="https://www.facebook.com/123.2870oo"
            target="_blank"
            rel="noreferrer"
          >
            Facebook
          </a>

          <a
            href="https://www.linkedin.com/in/huynh-tran-tong-143b65295/"
            target="_blank"
            rel="noreferrer"
          >
            LinkedIn
          </a>

          <div className={`api-status ${status}`}>
            <span className="status-dot"></span>
            API {status}
          </div>
        </nav>
      </header>

      <main>
        <section className="hero" id="home">
          <div className="hero-glow hero-glow-one"></div>
          <div className="hero-glow hero-glow-two"></div>

          <p className="eyebrow">AWS CLOUD E-COMMERCE DEMO VIP</p>

          <h1>
            Modern shopping.
            <br />
            <span>Built on the cloud.</span>
          </h1>

          <p className="hero-description">
            CloudShop is a containerized web application deployed on AWS ECS
            Fargate with automated CI/CD, Auto Scaling, Multi-AZ networking
            and HTTPS.
          </p>

          <div className="hero-actions">
            <a href="#products" className="primary-button">
              Explore Products
              <span>→</span>
            </a>

            <a
              href="https://github.com/tonghuynhv7/cloudshop"
              target="_blank"
              rel="noreferrer"
              className="secondary-button"
            >
              View GitHub
            </a>
          </div>

          <div className="tech-list">
            <span>AWS ECS</span>
            <span>Docker</span>
            <span>GitHub Actions</span>
            <span>Auto Scaling</span>
            <span>Route 53</span>
            <span>HTTPS</span>
          </div>
        </section>

        <section className="infra-grid">
          <div className="infra-card">
            <div className="infra-icon green">●</div>
            <div>
              <p>Production</p>
              <strong>
                {status === "healthy"
                  ? "Healthy"
                  : status === "offline"
                  ? "Offline"
                  : "Checking"}
              </strong>
            </div>
          </div>

          <div className="infra-card">
            <div className="infra-icon">☁</div>
            <div>
              <p>Deployment</p>
              <strong>ECS Fargate</strong>
            </div>
          </div>

          <div className="infra-card">
            <div className="infra-icon">↻</div>
            <div>
              <p>CI / CD</p>
              <strong>GitHub Actions</strong>
            </div>
          </div>

          <div className="infra-card">
            <div className="infra-icon">⌖</div>
            <div>
              <p>AWS Region</p>
              <strong>ap-southeast-1</strong>
            </div>
          </div>
        </section>

        <section className="products-section" id="products">
          <div className="section-header">
            <div>
              <p className="eyebrow">STORE</p>
              <h2>Featured Products</h2>

              <p className="section-description">
                Product data is loaded directly from the CloudShop API running
                on AWS ECS Fargate.
              </p>
            </div>

            <div className="product-count">
              {products.length} products
            </div>
          </div>

          <div className="product-grid">
            {products.map((product) => (
              <article className="product-card" key={product.id}>
                <div className="product-image">
                  <div className="product-circle">
                    {getProductIcon(product.name)}
                  </div>

                  <span className="product-badge">Available</span>
                </div>

                <div className="product-content">
                  <p className="product-category">
                    CLOUDSHOP PRODUCT
                  </p>

                  <h3>{product.name}</h3>

                  <div className="product-bottom">
                    <p className="price">
                      {product.price.toLocaleString("vi-VN")} ₫
                    </p>

                    <button type="button">
                      Add to cart
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="project-section">
          <div className="project-text">
            <p className="eyebrow">ABOUT THE PROJECT</p>

            <h2>
              More than a frontend.
              <br />
              <span>A complete DevOps project.</span>
            </h2>

            <p>
              CloudShop demonstrates a production-style AWS architecture with
              containerization, secure CI/CD, load balancing, auto scaling,
              HTTPS and infrastructure security.
            </p>

            <a
              href="https://github.com/tonghuynhv7/cloudshop"
              target="_blank"
              rel="noreferrer"
            >
              Explore source code →
            </a>
          </div>

          <div className="architecture-card">
            <div className="architecture-row">
              <span>01</span>
              <p>GitHub Actions</p>
              <strong>CI/CD</strong>
            </div>

            <div className="architecture-line"></div>

            <div className="architecture-row">
              <span>02</span>
              <p>Amazon ECR</p>
              <strong>Registry</strong>
            </div>

            <div className="architecture-line"></div>

            <div className="architecture-row">
              <span>03</span>
              <p>Application Load Balancer</p>
              <strong>Traffic</strong>
            </div>

            <div className="architecture-line"></div>

            <div className="architecture-row">
              <span>04</span>
              <p>ECS Fargate</p>
              <strong>Compute</strong>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-brand">
          <div className="footer-logo">C</div>

          <div>
            <strong>CloudShop</strong>
            <p>AWS DevOps Portfolio Project</p>
          </div>
        </div>

        <div className="footer-links">
          <a
            href="https://github.com/tonghuynhv7/cloudshop"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>

          <a
            href="https://www.facebook.com/123.2870oo"
            target="_blank"
            rel="noreferrer"
          >
            Facebook
          </a>

          <a
            href="https://www.linkedin.com/in/huynh-tran-tong-143b65295/"
            target="_blank"
            rel="noreferrer"
          >
            LinkedIn
          </a>
        </div>

        <p className="copyright">
          Built with React + AWS ECS Fargate
        </p>
      </footer>
    </div>
  );
}

export default App;