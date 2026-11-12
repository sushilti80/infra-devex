errors {
  # General Azure infrastructure retries
  retry "azure_infrastructure" {
    retryable_errors = concat(get_default_retryable_errors(), [
      "(?s).*timeout while waiting for state.*",
      "(?s).*connection reset by peer.*",
      "(?s).*TLS handshake timeout.*",
      "(?s).*i/o timeout.*",
      "(?s).*remote error: tls:.*",
      "(?s).*Error: Error building AzureRM Client.*",
      "(?s).*Error: Error retrieving.*",
      "(?s).*Error: timeout while waiting.*",
      "(?s).*RequestTimeout.*",
      "(?s).*ServiceUnavailable.*",
      "(?s).*status code: 429.*",
      "(?s).*TooManyRequests.*",
      "(?s).*Throttled.*",
      "(?s).*Error acquiring the state lock.*",
      "(?s).*state blob is already locked.*",
      "(?s).*no such host.*",
      "(?s).*dial tcp.*timeout.*",
      "(?s).*temporary failure in name resolution.*",
      "(?s).*dial tcp: lookup .* no such host.*", # <-- dynamic match
    ])
    max_attempts       = 3
    sleep_interval_sec = 5
  }

  # Azure Resource Manager operation conflicts
  retry "azure_arm_conflicts" {
    retryable_errors = [
      "(?s).*performing CreateOrUpdate: unexpected status 409.*AnotherOperationInProgress.*",
      "(?s).*409 Conflict.*AnotherOperationInProgress.*",
      "(?s).*Another operation on this or dependent resource is in progress.*",
      "(?s).*status 409.*Conflict.*",
      "(?s).*ConflictingOperation.*",
      "(?s).*ConcurrentOperationInProgress.*",
      "(?s).*removing Network Security Group Association.*409.*AnotherOperationInProgress.*",
      "(?s)unexpected status 409.*AnotherOperationInProgress"
    ]
    max_attempts       = 5
    sleep_interval_sec = 25
  }
}
