#!/bin/bash
sudo sysctl -w net.bridge.bridge-nf-call-iptables=0
sudo sysctl -w net.bridge.bridge-nf-call-ip6tables=0
sudo iptables -P FORWARD ACCEPT
docker compose -f docker-compose-local.yml down --remove-orphans
docker container prune -f
docker compose -f docker-compose-local.yml build api
docker compose -f docker-compose-local.yml build
docker compose -f docker-compose-local.yml up -d
echo "Docker containers started successfully."