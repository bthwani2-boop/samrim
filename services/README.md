# Services

Deployable backend services and bounded runtime owners live here.

A service must own a real runtime boundary, durable behavior, or canonical writer responsibility. Do not create shadow services, compatibility services, or duplicate responsibility trees.

Service-to-app dependency is forbidden. Apps may consume explicit public service contracts.
