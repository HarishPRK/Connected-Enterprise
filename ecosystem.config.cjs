module.exports = {
  apps: [{
    name: 'connected-enterprise',
    cwd: __dirname,
    script: 'npm',
    args: 'run start',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    watch: false,
  }],
};
