require('./config/env');
const { app } = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  // Intentionally silent to avoid leaking configuration in logs
});
