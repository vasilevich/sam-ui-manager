1. Copy the project to /opt/sam-ui-manager
2. Run npm install --omit=dev inside /opt/sam-ui-manager
3. Copy sam-ui-manager.service to /etc/systemd/system/
4. Copy sam-ui-manager.env.example to /etc/default/sam-ui-manager and edit if needed
5. sudo systemctl daemon-reload
6. sudo systemctl enable --now sam-ui-manager
