FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY day_type.py bucketing.py aggregation.py compute_averages.py ./

CMD ["python", "compute_averages.py"]
