-- Password for both demo users: "password123"
INSERT IGNORE INTO users (id, email, firstName, lastName, mobile, password, createdAt, updatedAt) VALUES
  ('a0000000-0000-4000-8000-000000000001', 'demo1@example.com', 'Demo', 'One', NULL, '$2b$10$If3hMJdQApd0RayPyqHmsezF25hPy.XFMsSIDhdJ3/Pyd/V4XvytW', NOW(), NOW()),
  ('a0000000-0000-4000-8000-000000000002', 'demo2@example.com', 'Demo', 'Two', NULL, '$2b$10$If3hMJdQApd0RayPyqHmsezF25hPy.XFMsSIDhdJ3/Pyd/V4XvytW', NOW(), NOW());
