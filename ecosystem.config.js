module.exports = {
  apps: [
    {
      name: 'seevar-crawler',
      script: './node_modules/.bin/ts-node',
      args: '-r tsconfig-paths/register src/main.ts',
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
