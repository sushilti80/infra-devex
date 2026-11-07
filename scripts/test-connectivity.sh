#!/bin/bash

echo "=========================================="
echo "Testing Service Connectivity"
echo "=========================================="

echo ""
echo "1. Testing Pod Directly (port 3000):"
POD_NAME=$(kubectl get pods -n self-service-test -l app=self-service-test-app -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n self-service-test $POD_NAME -- curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
echo ""

echo "2. Testing Service from within cluster (port 80):"
kubectl run -i --rm --restart=Never test-svc --image=curlimages/curl:latest -n self-service-test -- curl -s -w "Status: %{http_code}\n" http://self-service-test-svc/
echo ""

echo "3. Testing Ingress from within cluster:"
kubectl run -i --rm --restart=Never test-ingress --image=curlimages/curl:latest -n self-service-test -- curl -H "Host: self-service.sand.k8s.com" -s -w "Status: %{http_code}\n" http://10.255.4.10/
echo ""

echo "=========================================="
echo "Done"
echo "=========================================="
