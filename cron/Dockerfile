FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY day_type.py bucketing.py aggregation.py compute_averages.py predict.py ./

CMD ["python", "compute_averages.py"]
