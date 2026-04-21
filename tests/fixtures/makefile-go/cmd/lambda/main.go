package main

import (
	"context"

	"github.com/aws/aws-lambda-go/lambda"
)

func handler(context.Context) (string, error) {
	return "ok", nil
}

func main() {
	lambda.Start(handler)
}

