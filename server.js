require("dotenv").config();

const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// BASIC CONFIGURATION
// ============================================================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      "change-this-secret-before-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

app.use(express.static(path.join(__dirname, "public")));

// ============================================================
// DATABASE
// ============================================================

const db = new sqlite3.Database(
  "./aladdin-tech-world.db",
  (err) => {
    if (err) {
      console.error("Database error:", err.message);
    } else {
      console.log("Connected to SQLite database.");
    }
  }
);

// ============================================================
// CREATE TABLES
// ============================================================

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'customer',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      image TEXT,
      stock INTEGER DEFAULT 10,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cart (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1,
      UNIQUE(user_id, product_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      total REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      payment_reference TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      token TEXT NOT NULL,
      expires INTEGER NOT NULL
    )
  `);

  // ==========================================================
  // CREATE ADMIN ACCOUNT
  // ==========================================================

  const adminEmail = "quadrihamzat90@gmail.com";

  db.get(
    `SELECT id FROM users WHERE email = ?`,
    [adminEmail],
    async (err, user) => {
      if (err) {
        console.error("Admin check error:", err.message);
        return;
      }

      if (!user) {
        const adminPassword =
          process.env.ADMIN_PASSWORD ||
          "ChangeThisAdminPassword123!";

        const hash = await bcrypt.hash(adminPassword, 12);

        db.run(
          `
          INSERT INTO users
          (name, email, password, role)
          VALUES (?, ?, ?, ?)
          `,
          [
            "Aladdin Tech World Admin",
            adminEmail,
            hash,
            "admin"
          ],
          (insertErr) => {
            if (insertErr) {
              console.error(
                "Admin creation error:",
                insertErr.message
              );
            } else {
              console.log(
                "Admin account created:",
                adminEmail
              );
            }
          }
        );
      } else {
        console.log("Admin account already exists.");
      }
    }
  );

  // ==========================================================
  // SAMPLE PRODUCTS
  // ==========================================================

  db.get(
    `SELECT COUNT(*) AS count FROM products`,
    (err, row) => {
      if (err) {
        console.error(
          "Product count error:",
          err.message
        );
        return;
      }

      if (row.count === 0) {
        const products = [
          [
            "Wireless EarPods",
            "High-quality wireless EarPods.",
            15000,
            "/images/earpods.jpg",
            20
          ],
          [
            "USB Type-C Cable",
            "Fast charging USB Type-C cable.",
            5000,
            "/images/type-c.jpg",
            30
          ],
          [
            "Phone Charger",
            "Fast charging phone adapter.",
            10000,
            "/images/charger.jpg",
            20
          ],
          [
            "Bluetooth Speaker",
            "Portable Bluetooth speaker.",
            25000,
            "/images/speaker.jpg",
            15
          ],
          [
            "Laptop Stand",
            "Adjustable laptop stand.",
            18000,
            "/images/laptop-stand.jpg",
            10
          ],
          [
            "Wireless Mouse",
            "Comfortable wireless computer mouse.",
            12000,
            "/images/mouse.jpg",
            20
          ],
          [
            "Keyboard",
            "USB computer keyboard.",
            15000,
            "/images/keyboard.jpg",
            15
          ],
          [
            "Power Bank",
            "Portable power bank.",
            20000,
            "/images/powerbank.jpg",
            20
          ],
          [
            "Phone Holder",
            "Adjustable phone holder.",
            7000,
            "/images/phone-holder.jpg",
            25
          ],
          [
            "Laptop Backpack",
            "Protective laptop backpack.",
            30000,
            "/images/backpack.jpg",
            10
          ]
        ];

        const stmt = db.prepare(`
          INSERT INTO products
          (name, description, price, image, stock)
          VALUES (?, ?, ?, ?, ?)
        `);

        products.forEach((product) => {
          stmt.run(product);
        });

        stmt.finalize();

        console.log("10 sample products added.");
      }
    }
  );
});

// ============================================================
// AUTHENTICATION HELPERS
// ============================================================

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      error: "Please login first."
    });
  }

  next();
}

function requireAdmin(req, res, next) {
  if (
    !req.session.user ||
    req.session.user.role !== "admin"
  ) {
    return res.status(403).json({
      success: false,
      error: "Admin access required."
    });
  }

  next();
}

// ============================================================
// SIGN UP
// ============================================================

app.post("/api/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: "Name, email and password are required."
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 8 characters."
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    const hash = await bcrypt.hash(password, 12);

    db.run(
      `
      INSERT INTO users
      (name, email, password, role)
      VALUES (?, ?, ?, ?)
      `,
      [cleanName, cleanEmail, hash, "customer"],
      function (err) {
        if (err) {
          if (err.message.includes("UNIQUE")) {
            return res.status(400).json({
              success: false,
              error: "Email already exists."
            });
          }

          console.error(err);

          return res.status(500).json({
            success: false,
            error: "Could not create account."
          });
        }

        req.session.user = {
          id: this.lastID,
          name: cleanName,
          email: cleanEmail,
          role: "customer"
        };

        res.json({
          success: true,
          message: "Account created successfully.",
          user: req.session.user
        });
      }
    );
  } catch (error) {
    console.error(error);

    res.status(500).json({
      success: false,
      error: "Server error."
    });
  }
});

// ============================================================
// LOGIN
// ============================================================

app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      error: "Email and password are required."
    });
  }

  const cleanEmail = email.trim().toLowerCase();

  db.get(
    `
    SELECT id, name, email, password, role
    FROM users
    WHERE email = ?
    `,
    [cleanEmail],
    async (err, user) => {
      if (err) {
        console.error(err);

        return res.status(500).json({
          success: false,
          error: "Server error."
        });
      }

      if (!user) {
        return res.status(401).json({
          success: false,
          error: "Invalid email or password."
        });
      }

      try {
        const match = await bcrypt.compare(
          password,
          user.password
        );

        if (!match) {
          return res.status(401).json({
            success: false,
            error: "Invalid email or password."
          });
        }

        req.session.user = {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role
        };

        res.json({
          success: true,
          message: "Login successful.",
          user: req.session.user
        });
      } catch (error) {
        console.error(error);

        res.status(500).json({
          success: false,
          error: "Login error."
        });
      }
    }
  );
});

// ============================================================
// LOGOUT
// ============================================================

app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({
        success: false,
        error: "Could not logout."
      });
    }

    res.json({
      success: true,
      message: "Logged out successfully."
    });
  });
});

// ============================================================
// CURRENT USER
// ============================================================

app.get("/api/me", (req, res) => {
  if (!req.session.user) {
    return res.json({
      loggedIn: false
    });
  }

  res.json({
    loggedIn: true,
    user: req.session.user
  });
});

// ============================================================
// GET ALL PRODUCTS
// ============================================================

app.get("/api/products", (req, res) => {
  db.all(
    `
    SELECT *
    FROM products
    ORDER BY id DESC
    `,
    [],
    (err, products) => {
      if (err) {
        console.error(err);

        return res.status(500).json({
          success: false,
          error: "Could not load products."
        });
      }

      res.json({
        success: true,
        products
      });
    }
  );
});

// ============================================================
// GET ONE PRODUCT
// ============================================================

app.get("/api/products/:id", (req, res) => {
  db.get(
    `SELECT * FROM products WHERE id = ?`,
    [req.params.id],
    (err, product) => {
      if (err) {
        return res.status(500).json({
          success: false,
          error: "Database error."
        });
      }

      if (!product) {
        return res.status(404).json({
          success: false,
          error: "Product not found."
        });
      }

      res.json({
        success: true,
        product
      });
    }
  );
});

// ============================================================
// GET CART
// ============================================================

app.get("/api/cart", requireLogin, (req, res) => {
  db.all(
    `
    SELECT
      cart.product_id,
      cart.quantity,
      products.name,
      products.description,
      products.price,
      products.image,
      products.stock
    FROM cart
    JOIN products
      ON products.id = cart.product_id
    WHERE cart.user_id = ?
    `,
    [req.session.user.id],
    (err, cart) => {
      if (err) {
        console.error(err);

        return res.status(500).json({
          success: false,
          error: "Could not load cart."
        });
      }

      res.json({
        success: true,
        cart
      });
    }
  );
});

// ============================================================
// SAVE CART
// ============================================================

app.post("/api/cart/save", requireLogin, (req, res) => {
  const { cart } = req.body;

  if (!Array.isArray(cart)) {
    return res.status(400).json({
      success: false,
      error: "Cart must be an array."
    });
  }

  const userId = req.session.user.id;

  db.serialize(() => {
    db.run(
      `DELETE FROM cart WHERE user_id = ?`,
      [userId],
      (err) => {
        if (err) {
          console.error(err);

          return res.status(500).json({
            success: false,
            error: "Could not save cart."
          });
        }

        const stmt = db.prepare(`
          INSERT OR REPLACE INTO cart
          (user_id, product_id, quantity)
          VALUES (?, ?, ?)
        `);

        for (const item of cart) {
          let productId;
          let quantity;

          if (typeof item === "object") {
            productId = Number(
              item.id || item.product_id
            );
            quantity = Number(item.quantity || 1);
          } else {
            productId = Number(item);
            quantity = 1;
          }

          if (
            Number.isInteger(productId) &&
            productId > 0 &&
            Number.isInteger(quantity) &&
            quantity > 0
          ) {
            stmt.run(
              userId,
              productId,
              quantity
            );
          }
        }

        stmt.finalize();

        res.json({
          success: true,
          message: "Cart saved."
        });
      }
    );
  });
});

// ============================================================
// ADD TO CART
// ============================================================

app.post("/api/cart/add", requireLogin, (req, res) => {
  const { productId, quantity = 1 } = req.body;

  if (!productId) {
    return res.status(400).json({
      success: false,
      error: "Product ID is required."
    });
  }

  db.run(
    `
    INSERT INTO cart
    (user_id, product_id, quantity)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, product_id)
    DO UPDATE SET
      quantity = quantity + excluded.quantity
    `,
    [
      req.session.user.id,
      productId,
      quantity
    ],
    (err) => {
      if (err) {
        console.error(err);

        return res.status(500).json({
          success: false,
          error: "Could not add product to cart."
        });
      }

      res.json({
        success: true,
        message: "Product added to cart."
      });
    }
  );
});

// ============================================================
// REMOVE FROM CART
// ============================================================

app.delete(
  "/api/cart/:productId",
  requireLogin,
  (req, res) => {
    db.run(
      `
      DELETE FROM cart
      WHERE user_id = ?
      AND product_id = ?
      `,
      [
        req.session.user.id,
        req.params.productId
      ],
      (err) => {
        if (err) {
          return res.status(500).json({
            success: false,
            error: "Could not remove item."
          });
        }

        res.json({
          success: true,
          message: "Item removed."
        });
      }
    );
  }
);

// ============================================================
// FORGOT PASSWORD
// ============================================================

app.post(
  "/api/forgot-password",
  (req, res) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: "Email is required."
      });
    }

    const cleanEmail =
      email.trim().toLowerCase();

    db.get(
      `SELECT id FROM users WHERE email = ?`,
      [cleanEmail],
      (err, user) => {
        if (err) {
          return res.status(500).json({
            success: false,
            error: "Server error."
          });
        }

        const response = {
          success: true,
          message:
            "If an account exists with that email, a password reset link has been generated."
        };

        if (!user) {
          return res.json(response);
        }

        const token =
          crypto.randomBytes(32).toString("hex");

        const expires =
          Date.now() + 60 * 60 * 1000;

        db.run(
          `DELETE FROM resets WHERE email = ?`,
          [cleanEmail],
          () => {
            db.run(
              `
              INSERT INTO resets
              (email, token, expires)
              VALUES (?, ?, ?)
              `,
              [
                cleanEmail,
                token,
                expires
              ],
              (insertErr) => {
                if (insertErr) {
                  console.error(insertErr);

                  return res.json(response);
                }

                const baseUrl =
                  process.env.APP_URL ||
                  `http://localhost:${PORT}`;

                console.log(
                  "PASSWORD RESET LINK:",
                  `${baseUrl}/reset.html?token=${token}`
                );

                res.json(response);
              }
            );
          }
        );
      }
    );
  }
);

// ============================================================
// RESET PASSWORD
// ============================================================

app.post(
  "/api/reset-password",
  async (req, res) => {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        error: "Token and password are required."
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error:
          "Password must be at least 8 characters."
      });
    }

    db.get(
      `
      SELECT *
      FROM resets
      WHERE token = ?
      AND expires > ?
      `,
      [token, Date.now()],
      async (err, reset) => {
        if (err) {
          return res.status(500).json({
            success: false,
            error: "Server error."
          });
        }

        if (!reset) {
          return res.status(400).json({
            success: false,
            error:
              "Invalid or expired reset token."
          });
        }

        try {
          const hash =
            await bcrypt.hash(password, 12);

          db.run(
            `
            UPDATE users
            SET password = ?
            WHERE email = ?
            `,
            [hash, reset.email],
            (updateErr) => {
              if (updateErr) {
                return res.status(500).json({
                  success: false,
                  error:
                    "Could not reset password."
                });
              }

              db.run(
                `DELETE FROM resets WHERE token = ?`,
                [token],
                () => {
                  res.json({
                    success: true,
                    message:
                      "Password reset successfully."
                  });
                }
              );
            }
          );
        } catch (error) {
          console.error(error);

          res.status(500).json({
            success: false,
            error:
              "Could not reset password."
          });
        }
      }
    );
  }
);

// ============================================================
// CUSTOMER ORDERS
// ============================================================

app.get(
  "/api/orders",
  requireLogin,
  (req, res) => {
    db.all(
      `
      SELECT *
      FROM orders
      WHERE user_id = ?
      ORDER BY created_at DESC
      `,
      [req.session.user.id],
      (err, orders) => {
        if (err) {
          return res.status(500).json({
            success: false,
            error:
              "Could not load orders."
          });
        }

        res.json({
          success: true,
          orders
        });
      }
    );
  }
);

// ============================================================
// ADMIN ORDERS
// ============================================================

app.get(
  "/api/admin/orders",
  requireAdmin,
  (req, res) => {
    db.all(
      `
      SELECT
        orders.*,
        users.name,
        users.email
      FROM orders
      JOIN users
        ON users.id = orders.user_id
      ORDER BY orders.created_at DESC
      `,
      [],
      (err, orders) => {
        if (err) {
          return res.status(500).json({
            success: false,
            error:
              "Could not load orders."
          });
        }

        res.json({
          success: true,
          orders
        });
      }
    );
  }
);

// ============================================================
// ADMIN ADD PRODUCT
// ============================================================

app.post(
  "/api/admin/products",
  requireAdmin,
  (req, res) => {
    const {
      name,
      description = "",
      price,
      image = "",
      stock = 10
    } = req.body;

    if (!name || price === undefined) {
      return res.status(400).json({
        success: false,
        error:
          "Product name and price are required."
      });
    }

    db.run(
      `
      INSERT INTO products
      (name, description, price, image, stock)
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        name,
        description,
        Number(price),
        image,
        Number(stock)
      ],
      function (err) {
        if (err) {
          return res.status(500).json({
            success: false,
            error:
              "Could not create product."
          });
        }

        res.json({
          success: true,
          productId: this.lastID
        });
      }
    );
  }
);

// ============================================================
// ADMIN DELETE PRODUCT
// ============================================================

app.delete(
  "/api/admin/products/:id",
  requireAdmin,
  (req, res) => {
    db.run(
      `DELETE FROM products WHERE id = ?`,
      [req.params.id],
      (err) => {
        if (err) {
          return res.status(500).json({
            success: false,
            error:
              "Could not delete product."
          });
        }

        res.json({
          success: true,
          message: "Product deleted."
        });
      }
    );
  }
);

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    app: "Aladdin Tech World",
    status: "online"
  });
});

// ============================================================
// START SERVER
// ============================================================

app.listen(PORT, () => {
  console.log("==========================================");
  console.log("       ALADDIN TECH WORLD");
  console.log("==========================================");
  console.log(`Server running on port ${PORT}`);
  console.log(`Local: http://localhost:${PORT}`);
  console.log("==========================================");
});
