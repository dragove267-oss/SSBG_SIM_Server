module.exports = {
  apps: [
    {
      name: "game-server",
      script: "./game-server/app.js",
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 3000
      }
    },
    {
      name: "school-server",
      script: "./school-server/app.js",
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 4000
      }
    },
    {
      name: "admin-server",
      script: "./admin-server/app.js",
      watch: false,
      env: {
        NODE_ENV: "production",
        PORT: 5000
      }
    }
  ]
};
